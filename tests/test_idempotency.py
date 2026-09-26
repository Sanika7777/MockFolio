from types import SimpleNamespace

import pytest
from sqlalchemy.exc import IntegrityError

from backend.trading import IdempotencyConflict, _existing_trade, _is_duplicate_client_order_id


class _FakeOrig(Exception):
    def __init__(self, code, message):
        super().__init__(code, message)


class _FakeDB:
    def __init__(self, results):
        self._results = list(results)

    def scalar(self, _stmt):
        return self._results.pop(0)


def _order(account_id, instrument_id, side, quantity, order_id=1):
    return SimpleNamespace(
        order_id=order_id,
        account_id=account_id,
        instrument_id=instrument_id,
        side=side,
        quantity=quantity,
    )


def test_duplicate_client_order_id_is_detected():
    exc = IntegrityError("INSERT INTO orders ...", {}, _FakeOrig(1062, "Duplicate entry 'abc' for key 'uq_orders_client_id'"))
    assert _is_duplicate_client_order_id(exc) is True


def test_unrelated_duplicate_key_is_not_flagged():
    exc = IntegrityError("INSERT INTO users ...", {}, _FakeOrig(1062, "Duplicate entry 'bob' for key 'users.username'"))
    assert _is_duplicate_client_order_id(exc) is False


def test_no_existing_order_returns_none():
    assert _existing_trade(_FakeDB([None]), 1, 2, 5, "BUY", "key-1") is None


def test_matching_replay_returns_the_same_trade():
    trade = SimpleNamespace(trade_id=99)
    db = _FakeDB([_order(1, 2, "BUY", 5), trade])
    assert _existing_trade(db, 1, 2, 5, "BUY", "key-1") is trade


@pytest.mark.parametrize(
    "account_id, instrument_id, quantity, side",
    [
        (1, 2, 999, "BUY"),
        (1, 2, 5, "SELL"),
        (1, 999, 5, "BUY"),
        (2, 2, 5, "BUY"),
    ],
)
def test_reused_key_with_a_different_request_conflicts(account_id, instrument_id, quantity, side):
    db = _FakeDB([_order(1, 2, "BUY", 5)])
    with pytest.raises(IdempotencyConflict):
        _existing_trade(db, account_id, instrument_id, quantity, side, "key-1")
