import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

import backend.database as database

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_bogus_isolation_level_fails_to_start():
    env = dict(os.environ)
    env["TX_ISOLATION"] = "BOGUS"
    result = subprocess.run(
        [sys.executable, "-c", "import backend.database"],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode != 0
    assert "TX_ISOLATION" in result.stderr


def test_default_isolation_level_starts_fine():
    env = dict(os.environ)
    env.pop("TX_ISOLATION", None)
    result = subprocess.run(
        [sys.executable, "-c", "import backend.database"],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr


def test_non_integer_lock_wait_timeout_fails_to_start():
    env = dict(os.environ)
    env["LOCK_WAIT_TIMEOUT"] = "not-a-number"
    result = subprocess.run(
        [sys.executable, "-c", "import backend.database"],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode != 0
    assert "LOCK_WAIT_TIMEOUT" in result.stderr


def test_innodb_lock_wait_timeout_is_applied_in_a_real_session():
    """Uses the app's real engine directly (not the test-DB SessionLocal that
    tests/concurrency swaps in) since the connect-event listener that applies
    this setting is only attached to backend.database.engine itself."""
    try:
        with Session(database.engine) as db:
            value = db.execute(text("SELECT @@innodb_lock_wait_timeout")).scalar()
    except OperationalError as exc:
        pytest.skip(f"no live MySQL connection available: {exc}")
    assert int(value) == database.LOCK_WAIT_TIMEOUT
