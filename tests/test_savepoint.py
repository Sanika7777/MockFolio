from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.auth import hash_password
from backend.database import Base
from backend.models import Account, User
from backend.transactions import savepoint


@pytest.fixture()
def session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    LocalSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    db = LocalSession()
    yield db
    db.close()


class _Boom(Exception):
    pass


def test_savepoint_rollback_discards_only_its_own_work(session):
    user = User(username="save1", email="save1@test.local", password_hash=hash_password("x"))
    user.account = Account(cash_balance=Decimal("100.00"), starting_balance=Decimal("100.00"))
    session.add(user)
    session.commit()

    account = session.query(Account).filter_by(user_id=user.id).one()
    # "Earlier work" done before the savepoint (analogous to the account lock
    # + order row in execute_trade) -- this must survive a failure below.
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
    persisted = session.query(Account).filter_by(user_id=user.id).one()
    assert persisted.cash_balance == Decimal("50.00")


def test_savepoint_commits_normally_when_no_error(session):
    user = User(username="save2", email="save2@test.local", password_hash=hash_password("x"))
    user.account = Account(cash_balance=Decimal("100.00"), starting_balance=Decimal("100.00"))
    session.add(user)
    session.commit()

    account = session.query(Account).filter_by(user_id=user.id).one()
    with savepoint(session):
        account.cash_balance = Decimal("75.00")
        session.flush()

    session.commit()
    persisted = session.query(Account).filter_by(user_id=user.id).one()
    assert persisted.cash_balance == Decimal("75.00")
