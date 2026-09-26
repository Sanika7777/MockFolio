from sqlalchemy.exc import IntegrityError, OperationalError

from backend.trading import TradingError
from backend.transactions import is_retryable


class _FakeDBAPIError(Exception):
    def __init__(self, code):
        super().__init__(code, "simulated mysql error")


def _operational_error(code):
    return OperationalError("SELECT 1", {}, _FakeDBAPIError(code))


def test_deadlock_is_retryable():
    assert is_retryable(_operational_error(1213)) is True


def test_lock_wait_timeout_is_retryable():
    assert is_retryable(_operational_error(1205)) is True


def test_other_operational_error_is_not_retryable():
    assert is_retryable(_operational_error(1054)) is False


def test_trading_error_is_not_retryable():
    assert is_retryable(TradingError("Insufficient cash")) is False


def test_integrity_error_is_not_retryable():
    exc = IntegrityError("INSERT INTO orders ...", {}, _FakeDBAPIError(1062))
    assert is_retryable(exc) is False


def test_generic_exception_is_not_retryable():
    assert is_retryable(Exception("boom")) is False
