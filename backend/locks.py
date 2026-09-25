"""The only place in this codebase that takes row locks with `SELECT ... FOR UPDATE`.

Canonical lock order: stock -> account -> holding.
For operations that touch multiple stocks (decay, resets), lock stocks in
ascending `id` order.

Two module-level switches exist only for the Task 7 "turn it off" report
demos, read once from the environment so production behaviour is unchanged
by default:
- `MOCKFOLIO_LOCKING=off` makes every helper below use a plain `SELECT`
  (no `FOR UPDATE`), to demonstrate a lost update.
- `MOCKFOLIO_ORDERING=off` makes `lock_stocks` skip the ascending-id sort,
  to reproduce a lock-order deadlock on demand.
Never edit trading code to run those demos -- flip the env vars instead.
"""
import os
from sqlalchemy import select
from sqlalchemy.orm import Session
from .models import Account, Holding, Stock

def _env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() != "off"

LOCKING_ENABLED = _env_flag("MOCKFOLIO_LOCKING", True)
ORDERING_ENABLED = _env_flag("MOCKFOLIO_ORDERING", True)

def _maybe_locked(stmt):
    return stmt.with_for_update() if LOCKING_ENABLED else stmt

def lock_stock(db: Session, stock_id: int) -> Stock | None:
    return db.scalar(_maybe_locked(select(Stock).where(Stock.id == stock_id)))

def lock_account(db: Session, user_id: int) -> Account | None:
    return db.scalar(_maybe_locked(select(Account).where(Account.user_id == user_id)))

def lock_holding(db: Session, user_id: int, stock_id: int) -> Holding | None:
    return db.scalar(_maybe_locked(select(Holding).where(Holding.user_id == user_id, Holding.stock_id == stock_id)))

def lock_stocks(db: Session, stock_ids: list[int] | None = None) -> list[Stock]:
    """Lock every stock (or the given subset) for a multi-stock operation."""
    stmt = select(Stock) if stock_ids is None else select(Stock).where(Stock.id.in_(stock_ids))
    if ORDERING_ENABLED:
        stmt = stmt.order_by(Stock.id)
    return list(db.scalars(_maybe_locked(stmt)).all())
