"""Central transaction wrapper: retries MySQL deadlocks and lock-wait timeouts.

Every write path that needs retry-on-deadlock semantics should go through
`run_in_transaction`, which owns a fresh `SessionLocal()` per attempt so a
failed attempt can never leak a half-mutated session into a retry.
"""
import logging
import random
import threading
import time
from contextlib import contextmanager

from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from .database import SessionLocal

logger = logging.getLogger("mockfolio.tx")

MYSQL_DEADLOCK = 1213
MYSQL_LOCK_WAIT_TIMEOUT = 1205


def _mysql_error_code(exc: BaseException):
    if not isinstance(exc, OperationalError):
        return None
    orig = getattr(exc, "orig", None)
    args = getattr(orig, "args", None)
    if not args:
        return None
    return args[0]


def is_retryable(exc: BaseException) -> bool:
    """True only for MySQL deadlock (1213) or lock-wait-timeout (1205) errors."""
    return _mysql_error_code(exc) in (MYSQL_DEADLOCK, MYSQL_LOCK_WAIT_TIMEOUT)


class _Metrics:
    def __init__(self):
        self._lock = threading.Lock()
        self._counts = {"attempts": 0, "retries": 0, "deadlocks": 0, "lock_timeouts": 0, "gave_up": 0}

    def bump(self, key: str, amount: int = 1):
        with self._lock:
            self._counts[key] += amount

    def snapshot(self) -> dict:
        with self._lock:
            return dict(self._counts)

    def reset(self):
        with self._lock:
            for key in self._counts:
                self._counts[key] = 0


_metrics = _Metrics()


def get_metrics() -> dict:
    return _metrics.snapshot()


def reset_metrics():
    _metrics.reset()


@contextmanager
def savepoint(db: Session):
    """Wrap a block in a SQL SAVEPOINT (`db.begin_nested()`).

    A failure inside the block rolls back only the work done since the
    savepoint was taken -- work done earlier in the same outer transaction
    is untouched -- and then re-raises so the caller decides what happens
    next (in execute_trade, that means the whole trade attempt still fails
    and the outer transaction still aborts; the savepoint just guarantees
    the in-session state is exactly what it was before the failed block,
    rather than a partial mix of old and new values, at the moment it fails).
    """
    with db.begin_nested():
        yield

def run_in_transaction(fn, *, max_attempts: int = 3, base_delay: float = 0.05):
    """Run fn(db) in a fresh session, retrying on deadlock / lock-wait timeout.

    fn must be safe to call more than once (it is restarted from the
    beginning on every retry, against a brand-new session).
    """
    for attempt in range(max_attempts):
        _metrics.bump("attempts")
        db = SessionLocal()
        try:
            result = fn(db)
            db.commit()
            return result
        except Exception as exc:
            db.rollback()
            last_exc = exc
            code = _mysql_error_code(exc)
            if code == MYSQL_DEADLOCK:
                _metrics.bump("deadlocks")
            elif code == MYSQL_LOCK_WAIT_TIMEOUT:
                _metrics.bump("lock_timeouts")
            retryable = is_retryable(exc)
            if retryable and attempt < max_attempts - 1:
                _metrics.bump("retries")
                delay = base_delay * (2 ** attempt) + random.uniform(0, base_delay)
                logger.warning(
                    "retrying transaction after mysql error %s (attempt %d/%d)",
                    code, attempt + 1, max_attempts,
                )
                time.sleep(delay)
                continue
            if retryable:
                _metrics.bump("gave_up")
            raise
        finally:
            db.close()
