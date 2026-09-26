#!/usr/bin/env python
"""Task 8: crash-recovery (durability) demonstration.

Starts the real API as a subprocess against a dedicated test database, fires
a batch of ~200 BUY orders over real HTTP from a few threads, SIGKILLs the
app process mid-batch (never the database), restarts the app, and verifies:
  - every order the client received an HTTP 200 for has a matching trade row
  - no order exists without a trade, and no trade exists without an order
  - the money invariant still holds exactly

Prints PASS or FAIL. Run this three times in a row for the acceptance check
(each invocation is one independent trial against a freshly reset DB).

    python scripts/crash_recovery_demo.py

Requires TEST_DATABASE_URL (a dedicated, disposable MySQL database) that is
not the same as DATABASE_URL -- this script truncates tables in it.
"""
import json
import os
import subprocess
import sys
import threading
import time
import uuid
from decimal import Decimal
from pathlib import Path

import httpx

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

HOST = "127.0.0.1"
PORT = 8811
BASE_URL = f"http://{HOST}:{PORT}"
TOTAL_ORDERS = 200
THREAD_COUNT = 8
KILL_AT_FRACTION = 0.4  # kill once ~40% of requests have been attempted


def _require_test_database_url() -> str:
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        print("TEST_DATABASE_URL is not set; this script needs a dedicated, disposable MySQL database.", file=sys.stderr)
        sys.exit(1)
    if url == os.getenv("DATABASE_URL"):
        print("TEST_DATABASE_URL must not equal DATABASE_URL -- refusing to run against the real database.", file=sys.stderr)
        sys.exit(1)
    return url


def _reset_db(test_db_url: str):
    env = dict(os.environ)
    env["DATABASE_URL"] = test_db_url
    code = (
        "import sys; sys.path.insert(0, '.')\n"
        "from sqlalchemy import text\n"
        "import backend.transactions as t\n"
        "db = t.SessionLocal()\n"
        "db.execute(text('SET FOREIGN_KEY_CHECKS=0'))\n"
        "for tbl in ('audit_log','trades','orders','holdings','price_history','watchlist','accounts','users'):\n"
        "    db.execute(text('TRUNCATE TABLE ' + tbl))\n"
        "db.execute(text('SET FOREIGN_KEY_CHECKS=1'))\n"
        "db.execute(text('UPDATE stocks SET simulated_price = reference_price, previous_simulated_price = reference_price'))\n"
        "db.commit()\n"
        "db.close()\n"
    )
    subprocess.run([sys.executable, "-c", code], cwd=str(REPO_ROOT), env=env, check=True, timeout=30)


def _wait_for_server(timeout=45):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = httpx.get(f"{BASE_URL}/stocks", timeout=1)
            if r.status_code == 200:
                return
        except Exception:
            pass
        time.sleep(0.2)
    raise RuntimeError("server did not become ready in time")


def _start_app(test_db_url: str) -> subprocess.Popen:
    env = dict(os.environ)
    env["DATABASE_URL"] = test_db_url
    log_path = REPO_ROOT / f".crash_demo_uvicorn_{uuid.uuid4().hex[:8]}.log"
    log_file = open(log_path, "wb")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app", "--host", HOST, "--port", str(PORT)],
        cwd=str(REPO_ROOT), env=env,
        stdout=log_file, stderr=subprocess.STDOUT,
    )
    try:
        _wait_for_server()
    except Exception:
        # Never leak a process holding the port if startup didn't succeed --
        # a prior version of this script did exactly that, leaving a stale
        # listener that made every subsequent run fail to bind.
        proc.kill()
        proc.wait(timeout=10)
        log_file.close()
        tail = log_path.read_text(errors="replace")[-2000:]
        print(f"  app failed to become ready; last log output:\n{tail}", file=sys.stderr)
        raise
    finally:
        log_file.close()
        log_path.unlink(missing_ok=True)
    return proc


def _register_user(client: httpx.Client) -> str:
    suffix = uuid.uuid4().hex[:10]
    resp = client.post("/auth/register", json={
        "username": f"crash_{suffix}", "email": f"crash_{suffix}@test.local", "password": "password123",
    })
    resp.raise_for_status()
    return resp.json()["access_token"]


def _fire_batch_and_kill(proc: subprocess.Popen, token: str, stock_id: int) -> list[int]:
    successful_order_ids = []
    sent_count = {"n": 0}
    lock = threading.Lock()

    def worker(n_requests):
        headers = {"Authorization": f"Bearer {token}"}
        with httpx.Client(base_url=BASE_URL, timeout=5, headers=headers) as client:
            for _ in range(n_requests):
                key = str(uuid.uuid4())
                try:
                    resp = client.post("/trades/buy", json={"stock_id": stock_id, "quantity": 1, "client_order_key": key})
                    with lock:
                        sent_count["n"] += 1
                    if resp.status_code == 200:
                        order_id = resp.json()["order_id"]
                        with lock:
                            successful_order_ids.append(order_id)
                except Exception:
                    # Connection dropped by the SIGKILL -- expected once the app dies mid-request.
                    with lock:
                        sent_count["n"] += 1
                    return

    per_thread = TOTAL_ORDERS // THREAD_COUNT
    threads = [threading.Thread(target=worker, args=(per_thread,)) for _ in range(THREAD_COUNT)]
    for t in threads:
        t.start()

    target = int(TOTAL_ORDERS * KILL_AT_FRACTION)
    deadline = time.time() + 15
    while sent_count["n"] < target and time.time() < deadline and any(t.is_alive() for t in threads):
        time.sleep(0.002)

    print(f"  killing app after {sent_count['n']}/{TOTAL_ORDERS} requests attempted "
          f"({len(successful_order_ids)} client-perceived successes so far)")
    proc.kill()  # SIGKILL -- the app process, never the database
    proc.wait(timeout=10)

    for t in threads:
        t.join(timeout=15)

    print(f"  final: {sent_count['n']}/{TOTAL_ORDERS} requests attempted, "
          f"{len(successful_order_ids)} client-perceived successes")
    return successful_order_ids


def _verify(successful_order_ids: list[int]) -> bool:
    from sqlalchemy import select
    import backend.transactions as transactions
    from backend.models import Account, Holding, Order, Trade

    db = transactions.SessionLocal()
    try:
        ok = True
        orders_by_id = {o.id: o for o in db.scalars(select(Order)).all()}
        trades_by_order_id = {t.order_id: t for t in db.scalars(select(Trade)).all()}

        missing = [oid for oid in successful_order_ids if oid not in orders_by_id]
        if missing:
            print(f"  FAIL: {len(missing)} client-successful order(s) missing from orders table: {missing[:5]}")
            ok = False

        missing_trades = [oid for oid in successful_order_ids if oid in orders_by_id and oid not in trades_by_order_id]
        if missing_trades:
            print(f"  FAIL: {len(missing_trades)} client-successful order(s) have no matching trade: {missing_trades[:5]}")
            ok = False

        orphan_orders = set(orders_by_id) - set(trades_by_order_id)
        orphan_trades = set(trades_by_order_id) - set(orders_by_id)
        if orphan_orders:
            print(f"  FAIL: {len(orphan_orders)} order(s) exist with no trade: {sorted(orphan_orders)[:5]}")
            ok = False
        if orphan_trades:
            print(f"  FAIL: {len(orphan_trades)} trade(s) exist with no order: {sorted(orphan_trades)[:5]}")
            ok = False

        accounts = db.scalars(select(Account)).all()
        for account in accounts:
            if account.cash_balance < 0:
                print(f"  FAIL: negative cash for user {account.user_id}: {account.cash_balance}")
                ok = False

        total_cash = sum((a.cash_balance for a in accounts), Decimal("0"))
        total_starting = sum((a.starting_balance for a in accounts), Decimal("0"))
        all_trades = db.scalars(select(Trade)).all()
        net_flow = Decimal("0")
        for t in all_trades:
            value = t.fill_price * t.quantity
            net_flow += (value + t.brokerage) if t.side == "BUY" else -(value - t.brokerage)
        expected_cash = total_starting - net_flow
        if total_cash != expected_cash:
            print(f"  FAIL: money invariant violated: cash={total_cash} expected={expected_cash}")
            ok = False

        holdings = db.scalars(select(Holding)).all()
        for h in holdings:
            if h.quantity <= 0:
                print(f"  FAIL: non-positive holding quantity: user={h.user_id} stock={h.stock_id} qty={h.quantity}")
                ok = False

        print(f"  {len(successful_order_ids)} client-successful orders: all present with matching trades" if not missing and not missing_trades else "  (see FAILs above)")
        print(f"  {len(orders_by_id)} total orders, {len(trades_by_order_id)} total trades, "
              f"money invariant: {'OK (' + str(total_cash) + ')' if total_cash == expected_cash else 'VIOLATED'}")
        return ok
    finally:
        db.close()


def main():
    test_db_url = _require_test_database_url()
    os.environ["DATABASE_URL"] = test_db_url  # so this process's own backend.* imports below hit the test DB

    print("=== Crash recovery demo ===")
    _reset_db(test_db_url)

    proc = _start_app(test_db_url)
    successful_order_ids = []
    try:
        with httpx.Client(base_url=BASE_URL, timeout=5) as setup_client:
            token = _register_user(setup_client)
            stock_id = setup_client.get("/stocks").json()[0]["id"]
        successful_order_ids = _fire_batch_and_kill(proc, token, stock_id)
    finally:
        if proc.poll() is None:
            proc.kill()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass

    time.sleep(1.5)  # let MySQL notice the dropped connection and roll back any in-flight transaction

    print("restarting app...")
    proc2 = _start_app(test_db_url)
    print("app restarted cleanly")
    try:
        ok = _verify(successful_order_ids)
    finally:
        proc2.terminate()
        try:
            proc2.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc2.kill()

    print("\nPASS" if ok else "\nFAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
