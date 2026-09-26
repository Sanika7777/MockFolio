from types import SimpleNamespace

import pytest
from sqlalchemy.exc import IntegrityError

from backend.trading import IdempotencyConflict, _existing_trade_for_key, _is_duplicate_client_order_key


class _FakeOrig(Exception):
    def __init__(self, code, message):
        super().__init__(code, message)


class _FakeDB:
    """Stands in for a Session: returns canned db.scalar(...) results in call order."""
    def __init__(self, results):
        self._results = list(results)

    def scalar(self, _stmt):
        return self._results.pop(0)


def _order(user_id, stock_id, side, quantity, id=1):
    return SimpleNamespace(id=id, user_id=user_id, stock_id=stock_id, order_type=side, quantity=quantity)


def test_duplicate_client_order_key_is_detected():
    exc = IntegrityError("INSERT INTO orders ...", {}, _FakeOrig(1062, "Duplicate entry 'abc' for key 'orders.client_order_key'"))
    assert _is_duplicate_client_order_key(exc) is True


def test_unrelated_duplicate_key_is_not_flagged():
    exc = IntegrityError("INSERT INTO users ...", {}, _FakeOrig(1062, "Duplicate entry 'bob' for key 'users.username'"))
    assert _is_duplicate_client_order_key(exc) is False


def test_no_existing_order_returns_none():
    db = _FakeDB([None])
    assert _existing_trade_for_key(db, 1, 2, 5, "BUY", "key-1") is None


def test_matching_replay_returns_the_same_trade():
    trade = SimpleNamespace(id=99)
    db = _FakeDB([_order(user_id=1, stock_id=2, side="BUY", quantity=5), trade])
    assert _existing_trade_for_key(db, 1, 2, 5, "BUY", "key-1") is trade


def test_same_key_different_quantity_conflicts():
    db = _FakeDB([_order(user_id=1, stock_id=2, side="BUY", quantity=5)])
    with pytest.raises(IdempotencyConflict):
        _existing_trade_for_key(db, 1, 2, 999, "BUY", "key-1")


def test_same_key_different_side_conflicts():
    db = _FakeDB([_order(user_id=1, stock_id=2, side="BUY", quantity=5)])
    with pytest.raises(IdempotencyConflict):
        _existing_trade_for_key(db, 1, 2, 5, "SELL", "key-1")


def test_same_key_different_stock_conflicts():
    db = _FakeDB([_order(user_id=1, stock_id=2, side="BUY", quantity=5)])
    with pytest.raises(IdempotencyConflict):
        _existing_trade_for_key(db, 1, 999, 5, "BUY", "key-1")


def test_same_key_different_user_conflicts_and_never_returns_the_trade():
    db = _FakeDB([_order(user_id=1, stock_id=2, side="BUY", quantity=5)])
    with pytest.raises(IdempotencyConflict):
        _existing_trade_for_key(db, 2, 2, 5, "BUY", "key-1")
