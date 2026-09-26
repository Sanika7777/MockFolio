import threading
import time
import uuid
from decimal import Decimal

from sqlalchemy import select, text

import backend.database as database
from backend.auth import hash_password
from backend.models import Account, Holding, Instrument, Trade, User
from backend.price_engine import money
from backend.trading import TradingError

_TRUNCATE_TABLES = ("audit_log", "trades", "orders", "holdings", "candles_1m", "watchlist", "accounts", "users")

_summary = {"orders_filled": 0, "elapsed": 0.0}


def record_summary(orders_filled: int = 0, elapsed: float = 0.0):
    _summary["orders_filled"] += orders_filled
    _summary["elapsed"] += elapsed


def get_summary() -> dict:
    return dict(_summary)


def reset_db():
    db = database.SessionLocal()
    try:
        db.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for table in _TRUNCATE_TABLES:
            db.execute(text(f"TRUNCATE TABLE {table}"))
        db.execute(text("SET FOREIGN_KEY_CHECKS=1"))
        db.execute(text("UPDATE price_state SET perm_offset = 0, temp_offset = 0, last_decay_at = UTC_TIMESTAMP(3)"))
        db.commit()
    finally:
        db.close()


def make_accounts(n: int, cash: str = "100000.00") -> list[int]:
    db = database.SessionLocal()
    try:
        account_ids = []
        for _ in range(n):
            suffix = uuid.uuid4().hex[:10]
            user = User(username=f"conc_{suffix}", email=f"conc_{suffix}@test.local", password_hash=hash_password("x"), role="USER", is_active=1)
            db.add(user)
            db.flush()
            account = db.scalar(select(Account).where(Account.user_id == user.user_id))
            assert account is not None, "trg_users_ai_account did not create an account"
            account.cash_balance = Decimal(cash)
            account.starting_cash = Decimal(cash)
            account_ids.append(account.account_id)
        db.commit()
        return account_ids
    finally:
        db.close()


def get_instrument_ids(limit: int = 5) -> list[int]:
    db = database.SessionLocal()
    try:
        return list(
            db.scalars(
                select(Instrument.instrument_id)
                .where(Instrument.is_active == 1)
                .order_by(Instrument.instrument_id)
                .limit(limit)
            ).all()
        )
    finally:
        db.close()


def money_invariant(account_ids: list[int]):
    db = database.SessionLocal()
    try:
        accounts = db.scalars(select(Account).where(Account.account_id.in_(account_ids))).all()
        assert len(accounts) == len(account_ids), "an account is missing for one of the test users"
        for account in accounts:
            assert account.cash_balance >= 0, f"negative cash for account {account.account_id}: {account.cash_balance}"

        total_cash = sum((a.cash_balance for a in accounts), Decimal("0"))
        total_starting = sum((a.starting_cash for a in accounts), Decimal("0"))

        trades = db.scalars(select(Trade).where(Trade.account_id.in_(account_ids))).all()
        net_flow = Decimal("0")
        for t in trades:
            value = money(t.exec_price * t.quantity)
            net_flow += (value + t.brokerage) if t.side == "BUY" else -(value - t.brokerage)

        expected_cash = total_starting - net_flow
        assert total_cash == expected_cash, f"money invariant violated: cash={total_cash} expected={expected_cash}"

        holdings = db.scalars(select(Holding).where(Holding.account_id.in_(account_ids))).all()
        for h in holdings:
            assert h.quantity >= 0, f"negative holding: account={h.account_id} instrument={h.instrument_id} qty={h.quantity}"
    finally:
        db.close()


def run_workers(specs: list) -> dict:
    results = {"ok": 0, "rejected": 0, "errors": 0}
    lock = threading.Lock()
    exceptions = []

    def _run(spec):
        try:
            spec()
            with lock:
                results["ok"] += 1
        except TradingError as exc:
            with lock:
                results["rejected"] += 1
                exceptions.append(exc)
        except Exception as exc:
            with lock:
                results["errors"] += 1
                exceptions.append(exc)

    threads = [threading.Thread(target=_run, args=(spec,)) for spec in specs]
    start = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    elapsed = time.perf_counter() - start
    return {**results, "elapsed": elapsed, "exceptions": exceptions}
