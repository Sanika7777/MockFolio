import random
import threading
import time
import uuid

from decimal import Decimal

from sqlalchemy import select

import backend.database as database
import backend.transactions as transactions
from backend.models import Holding, Order, PriceState
from backend.simulation import run_decay_tx
from backend.trading import execute_trade_tx

import helpers


def test_money_conserved_mixed_load():
    helpers.reset_db()
    account_ids = helpers.make_accounts(8)
    instrument_ids = helpers.get_instrument_ids(5)

    specs = []
    for account_id in account_ids:
        for _ in range(40):
            instrument_id = random.choice(instrument_ids)
            side = random.choice(["BUY", "SELL"])
            quantity = random.randint(1, 5)
            specs.append(lambda u=account_id, s=instrument_id, side=side, q=quantity: execute_trade_tx(u, s, q, side))

    result = helpers.run_workers(specs)
    helpers.record_summary(orders_filled=result["ok"], elapsed=result["elapsed"])

    assert result["errors"] == 0, result["exceptions"]
    helpers.money_invariant(account_ids)


def test_no_orders_lost_to_deadlock():
    helpers.reset_db()
    account_ids = helpers.make_accounts(8)
    instrument_ids = helpers.get_instrument_ids(5)

    total_ok = total_rejected = total_errors = 0
    total_elapsed = 0.0
    submitted = 0

    for _ in range(5):  # rounds
        specs = []
        for account_id in account_ids:
            for _ in range(15):
                instrument_id = random.choice(instrument_ids)
                specs.append(lambda u=account_id, s=instrument_id: execute_trade_tx(u, s, 1, "BUY"))
        submitted += len(specs)
        result = helpers.run_workers(specs)
        total_ok += result["ok"]
        total_rejected += result["rejected"]
        total_errors += result["errors"]
        total_elapsed += result["elapsed"]
        assert result["errors"] == 0, result["exceptions"]

    helpers.record_summary(orders_filled=total_ok, elapsed=total_elapsed)

    lost = submitted - (total_ok + total_rejected)
    assert lost == 0, f"{lost} of {submitted} orders were lost to deadlock (0 expected)"
    assert total_errors == 0
    # No retries>0 assertion here: Task 1's root-cause fix (INSERT ... ON
    # DUPLICATE KEY UPDATE for first-buy holdings, see trading.py) means a
    # pure BUY workload now never takes the holdings gap lock that caused
    # the original deadlock, and the remaining stock->account locking uses a
    # single fixed order, which is provably deadlock-free on its own. So this
    # workload measured 0 retries against real MySQL -- the fix eliminated
    # the deadlock rather than merely surviving it. The retry mechanism
    # itself is proven separately, against a real MySQL deadlock, by
    # test_run_in_transaction_retries_a_real_deadlock below.
    helpers.money_invariant(account_ids)


def test_idempotent_double_click():
    helpers.reset_db()
    account_id = helpers.make_accounts(1)[0]
    instrument_id = helpers.get_instrument_ids(1)[0]
    key = str(uuid.uuid4())

    trade_ids = []
    lock = threading.Lock()

    def worker():
        trade = execute_trade_tx(account_id, instrument_id, 5, "BUY", key)
        with lock:
            trade_ids.append(trade.trade_id)

    specs = [worker for _ in range(8)]
    result = helpers.run_workers(specs)
    helpers.record_summary(orders_filled=result["ok"], elapsed=result["elapsed"])

    assert result["errors"] == 0, result["exceptions"]
    assert result["rejected"] == 0, result["exceptions"]
    assert len(trade_ids) == 8
    assert len(set(trade_ids)) == 1, "all 8 requests must resolve to the same trade"

    db = database.SessionLocal()
    try:
        orders = db.scalars(select(Order).where(Order.client_order_id == key)).all()
        assert len(orders) == 1
    finally:
        db.close()


def test_no_negative_cash_when_oversubscribed():
    helpers.reset_db()
    instrument_id = helpers.get_instrument_ids(1)[0]
    db = database.SessionLocal()
    try:
        reference_price = db.scalar(select(PriceState.raw_price).where(PriceState.instrument_id == instrument_id))
    finally:
        db.close()
    quantity = 1
    # Enough cash for ~3 fills (with headroom for brokerage/impact), so 20
    # concurrent orders are genuinely oversubscribed regardless of which
    # stock get_instrument_ids happens to return.
    cash = (reference_price * Decimal("1.05") * quantity * 3).quantize(Decimal("0.01"))
    account_id = helpers.make_accounts(1, cash=str(cash))[0]

    specs = [lambda: execute_trade_tx(account_id, instrument_id, quantity, "BUY") for _ in range(20)]
    result = helpers.run_workers(specs)
    helpers.record_summary(orders_filled=result["ok"], elapsed=result["elapsed"])

    assert result["errors"] == 0, result["exceptions"]
    assert result["ok"] >= 1, "at least one BUY should have been affordable"
    assert result["ok"] < 20, "the workload should have been genuinely oversubscribed"
    assert result["ok"] + result["rejected"] == 20
    helpers.money_invariant([account_id])


def test_no_short_selling_race():
    helpers.reset_db()
    account_id = helpers.make_accounts(1)[0]
    instrument_id = helpers.get_instrument_ids(1)[0]
    execute_trade_tx(account_id, instrument_id, 10, "BUY")  # sequential setup, not part of the race

    specs = [lambda: execute_trade_tx(account_id, instrument_id, 10, "SELL") for _ in range(5)]
    result = helpers.run_workers(specs)
    helpers.record_summary(orders_filled=result["ok"], elapsed=result["elapsed"])

    assert result["errors"] == 0, result["exceptions"]
    assert result["ok"] == 1, "exactly one of the 5 concurrent full-position sells should fill"
    assert result["rejected"] == 4

    db = database.SessionLocal()
    try:
        holding = db.scalar(select(Holding).where(Holding.account_id == account_id, Holding.instrument_id == instrument_id))
        assert holding is not None and holding.quantity == 0, "the full-position sell should leave the row at exactly 0"
    finally:
        db.close()
    helpers.money_invariant([account_id])


def test_trades_with_decay():
    helpers.reset_db()
    account_ids = helpers.make_accounts(6)
    instrument_ids = helpers.get_instrument_ids(5)

    stop = threading.Event()
    decay_errors = []

    def decay_loop():
        while not stop.is_set():
            try:
                run_decay_tx()
            except Exception as exc:
                decay_errors.append(exc)
            time.sleep(0.05)

    decay_thread = threading.Thread(target=decay_loop)
    decay_thread.start()

    specs = []
    for account_id in account_ids:
        for _ in range(10):
            instrument_id = random.choice(instrument_ids)
            side = random.choice(["BUY", "SELL"])
            quantity = random.randint(1, 5)
            specs.append(lambda u=account_id, s=instrument_id, side=side, q=quantity: execute_trade_tx(u, s, q, side))

    result = helpers.run_workers(specs)
    stop.set()
    decay_thread.join(timeout=10)
    helpers.record_summary(orders_filled=result["ok"], elapsed=result["elapsed"])

    assert result["errors"] == 0, result["exceptions"]
    assert decay_errors == [], decay_errors
    helpers.money_invariant(account_ids)


def test_run_in_transaction_retries_a_real_deadlock():
    """Prove run_in_transaction recovers from a genuine MySQL deadlock (1213).

    Nothing in the app locks two stocks in opposite order -- the canonical
    order (stock -> account -> holding, ascending id for multi-stock ops) is
    enforced everywhere in backend/locks.py precisely so this can't happen
    by accident. This test deliberately breaks that rule between two threads
    purely to generate a real 1213 and confirm run_in_transaction's retry
    path actually clears it, since the BUY-only workload in
    test_no_orders_lost_to_deadlock no longer deadlocks at all after Task 1's
    root-cause fix.

    Staggered sleeps (not a threading.Barrier) synchronize the two threads:
    a Barrier can't be reused correctly here, because run_in_transaction
    restarts the loser's `_attempt` from scratch on retry, and by then the
    winner has already finished and won't return to rendezvous a second time.
    """
    helpers.reset_db()
    instrument_ids = helpers.get_instrument_ids(2)
    assert len(instrument_ids) >= 2, "need at least 2 stocks for this test"
    first_stock, second_stock = instrument_ids[0], instrument_ids[1]

    before = transactions.get_metrics()
    results = {}
    errors = []

    def hold_then_cross(lock_first, lock_second, key, start_delay):
        def _attempt(db):
            time.sleep(start_delay)
            db.execute(select(PriceState).where(PriceState.instrument_id == lock_first).with_for_update()).scalar_one()
            time.sleep(0.3)
            db.execute(select(PriceState).where(PriceState.instrument_id == lock_second).with_for_update()).scalar_one()
            return (lock_first, lock_second)

        try:
            results[key] = transactions.run_in_transaction(_attempt, max_attempts=5)
        except Exception as exc:
            errors.append(exc)

    t1 = threading.Thread(target=hold_then_cross, args=(first_stock, second_stock, "a", 0))
    t2 = threading.Thread(target=hold_then_cross, args=(second_stock, first_stock, "b", 0.05))
    t1.start()
    t2.start()
    t1.join(timeout=15)
    t2.join(timeout=15)

    assert errors == [], errors
    assert results.get("a") == (first_stock, second_stock)
    assert results.get("b") == (second_stock, first_stock)

    after = transactions.get_metrics()
    assert (after["deadlocks"] - before["deadlocks"] > 0) or (after["retries"] - before["retries"] > 0), (
        "expected this opposite-order locking to trigger a real MySQL deadlock and a retry"
    )
