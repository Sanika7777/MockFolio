import os
from sqlalchemy import select
from sqlalchemy.orm import Session
from .models import Account, Holding, PriceState


def _env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() != "off"


LOCKING_ENABLED = _env_flag("MOCKFOLIO_LOCKING", True)
ORDERING_ENABLED = _env_flag("MOCKFOLIO_ORDERING", True)


def _maybe_locked(stmt):
    return stmt.with_for_update() if LOCKING_ENABLED else stmt


def lock_price_state(db: Session, instrument_id: int) -> PriceState | None:
    return db.scalar(_maybe_locked(select(PriceState).where(PriceState.instrument_id == instrument_id)))


def lock_account(db: Session, account_id: int) -> Account | None:
    return db.scalar(_maybe_locked(select(Account).where(Account.account_id == account_id)))


def lock_holding(db: Session, account_id: int, instrument_id: int) -> Holding | None:
    return db.scalar(
        _maybe_locked(
            select(Holding).where(Holding.account_id == account_id, Holding.instrument_id == instrument_id)
        )
    )
