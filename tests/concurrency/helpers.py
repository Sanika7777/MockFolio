"""Shared helpers for the concurrency test suite (Task 6).

Every helper here resolves `backend.transactions.SessionLocal` at call time
(not at import time), so it automatically follows whatever session factory
`conftest.py`'s autouse fixture has pointed at the dedicated test database
for the duration of the test session.
"""
import threading
import time
import uuid
from decimal import Decimal

from sqlalchemy import select, text

import backend.transactions as transactions
from backend.auth import hash_password
from backend.models import Account, Holding, Stock, Trade, User
from backend.trading import TradingError

# Fixed, code-controlled identifiers -- not user input -- so building the
# TRUNCATE statement this way is safe; table names can't be bind parameters.
_TRUNCATE_TABLES = ("audit_log", "trades", "orders", "holdings", "price_history", "watchlist", "accounts", "users")

_summary = {"orders_filled": 0, "elapsed": 0.0}


def record_summary(orders_filled: int = 0, elapsed: float = 0.0):
    _summary["orders_filled"] += orders_filled
    _summary["elapsed"] += elapsed


def get_summary() -> dict:
    return dict(_summary)


def reset_db():
    """Wipe all per-run data and reset stock prices. Only ever call this
    against the dedicated test database -- conftest.py refuses to even
    collect this package unless TEST_DATABASE_URL is set and differs from
    the app's real DATABASE_URL."""
    db = transactions.SessionLocal()
    try:
        db.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for table in _TRUNCATE_TABLES:
            db.execute(text(f"TRUNCATE TABLE {table}"))
        db.execute(text("SET FOREIGN_KEY_CHECKS=1"))
        db.execute(text("UPDATE stocks SET simulated_price = reference_price, previous_simulated_price = reference_price"))
        db.commit()
    finally:
        db.close()


def make_users(n: int, cash: str = "100000.00") -> list[int]:
    db = transactions.SessionLocal()
    try:
        ids = []
        for _ in range(n):
            suffix = uuid.uuid4().hex[:10]
            user = User(username=f"conc_{suffix}", email=f"conc_{suffix}@test.local", password_hash=hash_password("x"))
            user.account = Account(cash_balance=Decimal(cash), starting_balance=Decimal(cash))
            db.add(user)
            db.flush()
            ids.append(user.id)
        db.commit()
        return ids
    finally:
        db.close()


def get_stock_ids(limit: int = 5) -> list[int]:
    db = transactions.SessionLocal()
    try:
        return list(db.scalars(select(Stock.id).where(Stock.is_active).order_by(Stock.id).limit(limit)).all())
    finally:
        db.close()


def money_invariant(user_ids: list[int]):
    """Assert exact (Decimal) cash conservation and no negative cash / non-positive holdings."""
    db = transactions.SessionLocal()
    try:
        accounts = db.scalars(select(Account).where(Account.user_id.in_(user_ids))).all()
        assert len(accounts) == len(user_ids), "an account is missing for one of the test users"
        for account in accounts:
            assert account.cash_balance >= 0, f"negative cash for user {account.user_id}: {account.cash_balance}"

        total_cash = sum((a.cash_balance for a in accounts), Decimal("0"))
        total_starting = sum((a.starting_balance for a in accounts), Decimal("0"))

        trades = db.scalars(select(Trade).where(Trade.user_id.in_(user_ids))).all()
        net_flow = Decimal("0")
        for t in trades:
            value = t.fill_price * t.quantity
            net_flow += (value + t.brokerage) if t.side == "BUY" else -(value - t.brokerage)

        expected_cash = total_starting - net_flow
        assert total_cash == expected_cash, f"money invariant violated: cash={total_cash} expected={expected_cash}"

        holdings = db.scalars(select(Holding).where(Holding.user_id.in_(user_ids))).all()
        for h in holdings:
            assert h.quantity > 0, f"non-positive holding quantity: user={h.user_id} stock={h.stock_id} qty={h.quantity}"
    finally:
        db.close()


def run_workers(specs: list) -> dict:
    """Run each zero-arg callable in its own thread.

    Returns {"ok", "rejected", "errors", "elapsed", "exceptions"}. A
    TradingError is a business rejection ("rejected"); anything else raised
    is an unexpected failure ("errors") -- the thing Task 1/6 assert is 0.
    """
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
