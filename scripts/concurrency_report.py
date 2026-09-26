#!/usr/bin/env python
"""Task 7: "turn it off" demos for the DBMS report.

Produces reports/concurrency_results.json (raw numbers) and prints a
readable table. Never edits trading code to run a demo -- every scenario
below only flips the Task 4/5 env switches (MOCKFOLIO_LOCKING,
MOCKFOLIO_ORDERING, TX_ISOLATION). Those flags are read once at import time,
so each configuration runs in its own fresh subprocess with the env set
before Python starts, rather than mutating already-imported module state.

Usage:
    python scripts/concurrency_report.py

Requires TEST_DATABASE_URL (a dedicated, disposable MySQL database -- this
script truncates tables in it repeatedly) that is NOT the same as
DATABASE_URL. Every worker subprocess is launched with DATABASE_URL
overridden to TEST_DATABASE_URL's value, so the app's real engine (isolation
level, lock-wait timeout, connect-event listener and all) is exactly what's
under test -- no monkeypatching needed.
"""
import json
import os
import random
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = REPO_ROOT / "reports"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

ISOLATION_EXPLANATION = """\
Isolation level comparison -- why they differ:
- READ COMMITTED sees the latest committed data on every statement and takes
  the fewest gap locks, so it has the least blocking and typically the
  highest throughput / lowest latency here, at the cost of weaker repeatable-
  read guarantees (not exercised by a single read-then-write trade).
- REPEATABLE READ (this project's default) holds a consistent snapshot and
  takes gap locks for the whole transaction, which is why the original
  first-buy holdings deadlock (fixed in Task 1) existed at this level;
  expect moderate throughput and occasional lock waits under contention.
- SERIALIZABLE additionally takes shared locks on plain SELECTs, closer to
  fully serializing readers and writers of the same rows. Since every trade
  already does SELECT ... FOR UPDATE, the extra overhead over REPEATABLE READ
  is smaller here than in a read-heavy workload, but latency should still be
  the highest of the three and lock-wait timeouts (1205) more likely.
"""


# ---------------------------------------------------------------------------
# Minimal, self-contained DB helpers (worker-mode only). Deliberately not
# shared with tests/concurrency/helpers.py: this script runs as a fresh
# subprocess per configuration (no pytest fixture to lean on), and a report
# script depending on the test suite's internals (or vice versa) is the
# wrong coupling.
# ---------------------------------------------------------------------------

_TRUNCATE_TABLES = ("audit_log", "trades", "orders", "holdings", "candles_1m", "watchlist", "accounts", "users")


def _reset_db():
    from sqlalchemy import text
    import backend.database as database
    db = database.SessionLocal()
    try:
        db.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for table in _TRUNCATE_TABLES:
            db.execute(text(f"TRUNCATE TABLE {table}"))
        db.execute(text("SET FOREIGN_KEY_CHECKS=1"))
        db.execute(text("UPDATE price_state SET perm_offset = 0, temp_offset = 0, last_decay_at = UTC_TIMESTAMP(3)"))
        db.commit()
    finally:
        db.close()


def _make_accounts(n, cash="100000.00"):
    from sqlalchemy import select
    import backend.database as database
    from backend.auth import hash_password
    from backend.models import Account, User
    db = database.SessionLocal()
    try:
        ids = []
        for _ in range(n):
            suffix = uuid.uuid4().hex[:10]
            user = User(username=f"rep_{suffix}", email=f"rep_{suffix}@test.local", password_hash=hash_password("x"), role="USER", is_active=1)
            db.add(user)
            db.flush()
            account = db.scalar(select(Account).where(Account.user_id == user.user_id))
            account.cash_balance = Decimal(cash)
            account.starting_cash = Decimal(cash)
            ids.append(account.account_id)
        db.commit()
        return ids
    finally:
        db.close()


def _get_instrument_ids(limit=5):
    from sqlalchemy import select
    import backend.database as database
    from backend.models import Instrument
    db = database.SessionLocal()
    try:
        return list(db.scalars(select(Instrument.instrument_id).where(Instrument.is_active == 1).order_by(Instrument.instrument_id).limit(limit)).all())
    finally:
        db.close()


def _get_instrument_price(instrument_id):
    from sqlalchemy import select
    import backend.database as database
    from backend.models import PriceState
    db = database.SessionLocal()
    try:
        return db.scalar(select(PriceState.adjusted_price).where(PriceState.instrument_id == instrument_id))
    finally:
        db.close()


def _run_workers_timed(specs):
    from backend.trading import TradingError
    results = {"ok": 0, "rejected": 0, "errors": 0}
    durations = []
    lock = threading.Lock()

    def _run(spec):
        start = time.perf_counter()
        try:
            spec()
            outcome = "ok"
        except TradingError:
            outcome = "rejected"
        except Exception:
            outcome = "errors"
        duration = time.perf_counter() - start
        with lock:
            results[outcome] += 1
            durations.append(duration)

    threads = [threading.Thread(target=_run, args=(s,)) for s in specs]
    t0 = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    elapsed = time.perf_counter() - t0
    mean_latency = sum(durations) / len(durations) if durations else 0.0
    return {**results, "elapsed": elapsed, "mean_latency": mean_latency}


# ---------------------------------------------------------------------------
# Worker-mode scenarios (each runs in its own freshly-started subprocess)
# ---------------------------------------------------------------------------

def _worker_lost_update(payload):
    from sqlalchemy import select
    import backend.database as database
    from backend.models import Account, Trade
    from backend.price_engine import money
    from backend.trading import execute_trade_tx

    _reset_db()
    starting_cash = Decimal(payload["starting_cash"])
    concurrency = payload["concurrency"]
    quantity = payload.get("quantity", 1)

    account_id = _make_accounts(1, cash=str(starting_cash))[0]
    instrument_id = _get_instrument_ids(1)[0]

    specs = [lambda: execute_trade_tx(account_id, instrument_id, quantity, "BUY") for _ in range(concurrency)]
    result = _run_workers_timed(specs)

    db = database.SessionLocal()
    try:
        account = db.scalar(select(Account).where(Account.account_id == account_id))
        trades = db.scalars(select(Trade).where(Trade.account_id == account_id)).all()
    finally:
        db.close()

    expected = starting_cash
    for t in trades:
        expected -= (money(t.exec_price * t.quantity) + t.brokerage)
    actual = account.cash_balance
    discrepancy = actual - expected

    return {
        "ok": result["ok"], "rejected": result["rejected"], "errors": result["errors"],
        "trades_recorded": len(trades),
        "expected_cash": str(expected), "actual_cash": str(actual), "discrepancy": str(discrepancy),
    }


def _worker_deadlock(payload):
    from backend.locks import ORDERING_ENABLED, lock_price_state
    from sqlalchemy.exc import OperationalError
    import backend.database as database

    _reset_db()
    instrument_ids = payload.get("instrument_ids") or _get_instrument_ids(2)
    a, b = instrument_ids[0], instrument_ids[1]

    errors = []
    captured = {"text": None}
    capture_lock = threading.Lock()

    def capture_innodb_status():
        with capture_lock:
            if captured["text"] is not None:
                return
            try:
                with database.engine.connect() as conn:
                    row = conn.exec_driver_sql("SHOW ENGINE INNODB STATUS").fetchone()
                    captured["text"] = row[2] if row else None
            except Exception:
                pass

    def buy_two(ids_in_request_order):
        # Mirrors what a hypothetical multi-stock trade would do with the
        # real ORDERING_ENABLED flag and the real lock_price_state() helper from
        # backend/locks.py (Task 4) -- nothing here is demo-only code.
        ordered = sorted(ids_in_request_order) if ORDERING_ENABLED else list(ids_in_request_order)
        db = database.SessionLocal()
        try:
            with db.begin():
                lock_price_state(db, ordered[0])
                time.sleep(0.3)
                lock_price_state(db, ordered[1])
        except OperationalError as exc:
            code = exc.orig.args[0] if getattr(exc, "orig", None) and getattr(exc.orig, "args", None) else None
            if code == 1213:
                capture_innodb_status()
            errors.append(f"OperationalError({code})")
        except Exception as exc:
            errors.append(repr(exc))
        finally:
            db.close()

    t1 = threading.Thread(target=buy_two, args=([a, b],))
    t2 = threading.Thread(target=buy_two, args=([b, a],))
    t1.start()
    time.sleep(0.05)
    t2.start()
    t1.join(timeout=15)
    t2.join(timeout=15)

    deadlock_count = sum(1 for e in errors if "1213" in e)
    return {
        "ordering_enabled": ORDERING_ENABLED,
        "errors": errors,
        "deadlock_count": deadlock_count,
        "innodb_status": captured["text"],
    }


def _worker_isolation(payload):
    import backend.transactions as transactions
    from backend.trading import execute_trade_tx
    import backend.database as database

    _reset_db()
    account_ids = _make_accounts(payload.get("users", 8))
    instrument_ids = _get_instrument_ids(payload.get("instruments", 5))

    specs = []
    for account_id in account_ids:
        for _ in range(payload.get("orders_per_user", 10)):
            instrument_id = random.choice(instrument_ids)
            side = random.choice(["BUY", "SELL"])
            quantity = random.randint(1, 5)
            specs.append(lambda u=account_id, s=instrument_id, side=side, q=quantity: execute_trade_tx(u, s, q, side))

    result = _run_workers_timed(specs)
    metrics = transactions.get_metrics()
    total = result["ok"] + result["rejected"]
    throughput = total / result["elapsed"] if result["elapsed"] > 0 else 0.0

    return {
        "isolation": database.TX_ISOLATION,
        "ok": result["ok"], "rejected": result["rejected"], "errors": result["errors"],
        "elapsed": result["elapsed"], "mean_latency": result["mean_latency"],
        "throughput_per_sec": throughput,
        "deadlocks": metrics["deadlocks"], "retries": metrics["retries"], "lock_timeouts": metrics["lock_timeouts"],
    }


_SCENARIOS = {"lost_update": _worker_lost_update, "deadlock": _worker_deadlock, "isolation": _worker_isolation}


def _worker_main():
    scenario = sys.argv[2]
    payload = json.loads(sys.stdin.read() or "{}")
    result = _SCENARIOS[scenario](payload)
    print(json.dumps(result))


# ---------------------------------------------------------------------------
# Orchestrator (default mode): spawns one subprocess per configuration
# ---------------------------------------------------------------------------

def _require_test_database_url() -> str:
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        print("TEST_DATABASE_URL is not set; this script needs a dedicated, disposable MySQL database.", file=sys.stderr)
        sys.exit(1)
    if url == os.getenv("DATABASE_URL"):
        print("TEST_DATABASE_URL must not equal DATABASE_URL -- refusing to run against the real database.", file=sys.stderr)
        sys.exit(1)
    return url


def _run_worker(scenario: str, env_overrides: dict, payload: dict, test_db_url: str) -> dict:
    env = dict(os.environ)
    env["DATABASE_URL"] = test_db_url
    env.update(env_overrides)
    result = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--worker", scenario],
        cwd=str(REPO_ROOT),
        env=env,
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"worker {scenario} (env={env_overrides}) failed:\nstdout={result.stdout}\nstderr={result.stderr}")
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError(f"worker {scenario} (env={env_overrides}) produced no output:\nstderr={result.stderr}")
    return json.loads(lines[-1])


def _mysql_version(test_db_url: str) -> str:
    env = dict(os.environ)
    env["DATABASE_URL"] = test_db_url
    result = subprocess.run(
        [sys.executable, "-c", "import backend.database as d; from sqlalchemy.orm import Session\nwith Session(d.engine) as s:\n    print(s.execute(__import__('sqlalchemy').text('SELECT VERSION()')).scalar())"],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return result.stdout.strip() or "unknown"


def main():
    test_db_url = _require_test_database_url()
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mysql_version": _mysql_version(test_db_url),
    }

    print("=== Task 7: concurrency report ===")
    print(f"MySQL version: {report['mysql_version']}")

    # 1. Lost update demo -----------------------------------------------
    print("\n-- Lost update demo (many concurrent BUYs on one account) --")
    lost_update_runs = []
    concurrency = 10
    for locking in ("off", "on"):
        for run_no in range(1, 6):
            payload = {"starting_cash": "1000000.00", "concurrency": concurrency, "quantity": 1}
            result = _run_worker("lost_update", {"MOCKFOLIO_LOCKING": locking}, payload, test_db_url)
            result.update({"locking": locking, "run": run_no, "thread_count": concurrency})
            lost_update_runs.append(result)
            print(f"  locking={locking:<3} run={run_no} ok={result['ok']:<2} discrepancy={result['discrepancy']}")
    report["lost_update"] = lost_update_runs

    # 2. Deadlock demo -----------------------------------------------------
    print("\n-- Deadlock demo (two threads locking two stocks in opposite order) --")
    instrument_ids = None
    deadlock_runs = []
    for ordering in ("off", "on"):
        for run_no in range(1, 4):
            payload = {"instrument_ids": instrument_ids} if instrument_ids else {}
            result = _run_worker("deadlock", {"MOCKFOLIO_ORDERING": ordering}, payload, test_db_url)
            result.update({"ordering": ordering, "run": run_no, "thread_count": 2})
            deadlock_runs.append(result)
            print(f"  ordering={ordering:<3} run={run_no} deadlocks={result['deadlock_count']}")
            if result["innodb_status"] and not (REPORTS_DIR / "deadlock_capture.txt").exists():
                (REPORTS_DIR / "deadlock_capture.txt").write_text(result["innodb_status"], encoding="utf-8")
    report["deadlock"] = deadlock_runs
    if not (REPORTS_DIR / "deadlock_capture.txt").exists():
        (REPORTS_DIR / "deadlock_capture.txt").write_text(
            "No deadlock's SHOW ENGINE INNODB STATUS section was captured in this run "
            "(no deadlock occurred with ordering disabled -- see reports/concurrency_results.json "
            "for the raw deadlock_count per run).\n",
            encoding="utf-8",
        )

    # 3. Isolation level comparison -----------------------------------------
    print("\n-- Isolation level comparison --")
    isolation_runs = []
    for level in ("READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"):
        for run_no in range(1, 6):
            payload = {"users": 8, "instruments": 5, "orders_per_user": 10}
            result = _run_worker("isolation", {"TX_ISOLATION": level}, payload, test_db_url)
            result.update({"run": run_no, "thread_count": 80})
            isolation_runs.append(result)
            print(f"  {level:<16} run={run_no} throughput={result['throughput_per_sec']:.1f}/s mean_latency={result['mean_latency']*1000:.1f}ms deadlocks={result['deadlocks']} retries={result['retries']}")
    report["isolation"] = isolation_runs
    report["isolation_explanation"] = ISOLATION_EXPLANATION

    results_path = REPORTS_DIR / "concurrency_results.json"
    results_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    # Summary table -----------------------------------------------------
    print("\n=== Summary ===")
    on_discrepancies = [r["discrepancy"] for r in lost_update_runs if r["locking"] == "on"]
    off_discrepancies = [r["discrepancy"] for r in lost_update_runs if r["locking"] == "off"]
    print(f"Lost update: locking=on discrepancies={on_discrepancies}")
    print(f"Lost update: locking=off discrepancies={off_discrepancies}")
    off_deadlocks = sum(r["deadlock_count"] for r in deadlock_runs if r["ordering"] == "off")
    on_deadlocks = sum(r["deadlock_count"] for r in deadlock_runs if r["ordering"] == "on")
    print(f"Deadlock demo: ordering=off total deadlocks={off_deadlocks}, ordering=on total deadlocks={on_deadlocks}")
    print(f"\nWrote {results_path}")
    print(f"Wrote {REPORTS_DIR / 'deadlock_capture.txt'}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--worker":
        _worker_main()
    else:
        main()
