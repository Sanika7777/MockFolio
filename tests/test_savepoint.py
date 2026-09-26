from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.models import Account, User
from backend.transactions import savepoint


@pytest.fixture()
def session():
    engine = create_engine("sqlite:///:memory:")
    User.__table__.create(engine)
    Account.__table__.create(engine)
    LocalSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    db = LocalSession()
    yield db
    db.close()


def _seed_account(session, username: str) -> Account:
    user = User(username=username, email=f"{username}@test.local", password_hash="x", role="USER", is_active=1)
    session.add(user)
    session.flush()
    account = Account(
        user_id=user.user_id,
        cash_balance=Decimal("100.00"),
        starting_cash=Decimal("100.00"),
        blocked_margin=Decimal("0"),
        realised_pl=Decimal("0"),
        version=0,
    )
    session.add(account)
    session.commit()
    return account


class _Boom(Exception):
    pass


def test_savepoint_rollback_discards_only_its_own_work(session):
    account = _seed_account(session, "save1")
    account.cash_balance = Decimal("50.00")
    session.flush()

    with pytest.raises(_Boom):
        with savepoint(session):
            account.cash_balance = Decimal("999999.00")
            session.flush()
            raise _Boom("simulated failure inside the price/holding/trade block")

    session.expire(account)
    assert account.cash_balance == Decimal("50.00")

    session.commit()
    assert session.get(Account, account.account_id).cash_balance == Decimal("50.00")


def test_savepoint_commits_normally_when_no_error(session):
    account = _seed_account(session, "save2")
    with savepoint(session):
        account.cash_balance = Decimal("75.00")
        session.flush()

    session.commit()
    assert session.get(Account, account.account_id).cash_balance == Decimal("75.00")
