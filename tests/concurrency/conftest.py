"""Session setup for the concurrency test suite (Task 6).

These tests use real threads against a dedicated MySQL test database. The
app's trading/decay code always resolves `SessionLocal` from module state at
call time (see backend/transactions.py, backend/trading.py), so this fixture
points that module state at the test database for the whole session instead
of requiring DATABASE_URL itself to be changed -- the app's real
DATABASE_URL-configured engine is never touched.
"""
import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.database as database
import backend.trading as trading
import backend.transactions as transactions

import helpers


def _test_database_url() -> str:
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set; concurrency tests need a dedicated MySQL test database (see MOCKFOLIO_REMAINING_TASKS.md Task 6)")
    if url == database.DATABASE_URL:
        pytest.exit(
            "TEST_DATABASE_URL must not equal DATABASE_URL -- refusing to run "
            "concurrency tests, which truncate tables, against the real database.",
            returncode=1,
        )
    return url


@pytest.fixture(scope="session", autouse=True)
def _point_app_at_test_database():
    test_engine = create_engine(_test_database_url(), pool_pre_ping=True, pool_size=20, max_overflow=20, future=True)
    test_session_local = sessionmaker(bind=test_engine, autoflush=False, autocommit=False, expire_on_commit=False)

    originals = (database.SessionLocal, transactions.SessionLocal, trading.SessionLocal)
    database.SessionLocal = test_session_local
    transactions.SessionLocal = test_session_local
    trading.SessionLocal = test_session_local
    try:
        yield
    finally:
        database.SessionLocal, transactions.SessionLocal, trading.SessionLocal = originals
        test_engine.dispose()


def pytest_sessionfinish(session, exitstatus):
    if not os.getenv("TEST_DATABASE_URL"):
        return
    metrics = transactions.get_metrics()
    summary = helpers.get_summary()
    print(
        f"\n[concurrency summary] orders_filled={summary['orders_filled']} "
        f"retries={metrics['retries']} deadlocks={metrics['deadlocks']} "
        f"lock_timeouts={metrics['lock_timeouts']} gave_up={metrics['gave_up']} "
        f"elapsed={summary['elapsed']:.2f}s"
    )
