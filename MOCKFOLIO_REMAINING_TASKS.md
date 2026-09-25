# MockFolio — Remaining Work (for Claude Code)

> **How to use this file:** Put it in the project root (next to `README.md`), open Claude Code
> in that folder, and tell it: *"Read MOCKFOLIO_REMAINING_TASKS.md and do Task 1. Stop when its
> acceptance checks pass and show me the results before starting Task 2."*
> Do the tasks **in order**. Each task is small enough to finish and verify on its own.

---

## 0. Project context (read this first)

MockFolio is a multi-user paper-trading platform built as a **DBMS mini-project**. Users trade with
virtual money. Every trade moves a **simulated price** (`stocks.simulated_price`), which then decays
back toward a **reference price** (`stocks.reference_price`).

**Stack:** Python 3 · FastAPI · SQLAlchemy 2.0 · PyMySQL · MySQL 8 (InnoDB) · vanilla HTML/JS frontend.

**Layout (only files that matter here):**

```
backend/
  main.py          FastAPI app + all routes (single file)
  trading.py       execute_trade(): the BUY/SELL transaction
  price_engine.py  impact / decay maths (pure functions)
  database.py      engine, SessionLocal, get_db
  models.py        SQLAlchemy models
  schemas.py       Pydantic request/response models
  auth.py          JWT + bcrypt
sql/               schema.sql, triggers.sql, views.sql, procedures.sql, seed.sql
frontend/          static pages; frontend/js/api.js is the one API client
tests/             test_price_impact.py, test_trading.py
```

### Explicitly OUT OF SCOPE — do not do these
- **Hosting / deployment / Docker / HTTPS.**
- **Any real-market-price API** (AngelOne, Yahoo, etc.). Reference prices stay as seeded.
- **WebSockets / live push.**
- Do not rename tables or columns that already exist. Do not change the meaning of any existing API response field.

### Ground rules for every task
1. **Money is `Decimal`, never `float`.** Use `money()` from `price_engine.py` for rounding.
2. **Parameterised queries / ORM only.** No f-string SQL.
3. **Do not weaken the existing behaviour.** The BUY/SELL flow already conserves money correctly
   (verified: total cash always equals starting cash minus net trade cash flow, to the paisa).
   Never trade that away for speed.
4. Run `pytest` after every task. Existing tests must keep passing.
5. Keep changes minimal and local. Prefer a new small file over rewriting `main.py`.
6. After each task, append a short entry to `CHANGELOG.md` (create it if missing).

### How to run things (needed for the tests below)
MySQL must be running with the project DB loaded (see README). Set `DATABASE_URL` in `.env`.
Concurrency tests need a **real MySQL**, not SQLite — row locks and deadlocks don't exist in SQLite.

---

## STATUS: Is transaction control implemented?

**Short answer: partially. The locking is correct; the recovery is missing.**

This was verified by running the project's real, unmodified `execute_trade()` against MySQL 8 with
real threads (each with its own connection).

| Transaction-control feature | Status | Evidence |
|---|---|---|
| Atomic commit / rollback of a trade | ✅ Implemented | `trading.py` does one commit; `main.py` rolls back on error |
| Row locking (`SELECT … FOR UPDATE`) on stock, account, holding | ✅ Implemented | Money conserved exactly across hundreds of concurrent trades; 0 negative balances |
| DB-level constraints (no negative cash / quantity) | ✅ Implemented | `UPDATE accounts SET cash_balance=-5` → `ERROR 3819 check constraint violated` |
| Idempotency key (unique `client_order_key`) | ⚠️ Half done | Works for *sequential* repeats. **Fails under a race** (see Task 2) |
| **Deadlock retry** | ❌ **Missing** | ~**7% of orders lost** under modest concurrent buying: 43 of 590 |
| **Deadlock root cause** | ❌ **Not handled** | Gap-lock deadlock on `holdings` (see Task 1) |
| Savepoints | ❌ Missing | Zero occurrences in code |
| Central transaction wrapper / single lock-helper file | ❌ Missing | Locking is inline in `execute_trade` |
| Decay endpoint lock-order safe vs trades | ❌ Not safe | `POST /simulation/decay` deadlocked against concurrent trades |
| Explicit isolation level, lock-wait timeout, deadlock logging | ❌ Missing | Defaults only (REPEATABLE READ) |
| Retry / deadlock counters (evidence for report) | ❌ Missing | Nothing recorded |
| Concurrency test suite + "turn-off" switches | ❌ Missing | `test_trading.py` only contains two trivial asserts |
| Deadlock / lost-update / isolation-level demonstrations | ❌ Missing | None |

**Why the deadlock happens (important — do not "fix" it by reordering stock/account locks):**
It is *not* a stock-vs-account lock-order bug. On a user's **first** buy of a stock, the code runs
`SELECT … FROM holdings … FOR UPDATE` on a row that does not exist yet. At REPEATABLE READ, InnoDB
takes a **gap lock** on the index gap. Two concurrent first-buys both hold the same gap lock, then
both try to `INSERT` into it, and each waits on the other. MySQL's own report:
`INSERT INTO holdings … waiting for insert-intention lock … WE ROLL BACK TRANSACTION (2)`.
It happens even with a single stock.

---

# TASKS

## Task 1 — Central transaction layer with deadlock retry  *(highest priority)*

**Goal:** Every write transaction goes through one wrapper that retries deadlocks safely, so no
order is silently lost.

**Create `backend/transactions.py`:**

1. `is_retryable(exc) -> bool` — true only for MySQL errors **1213 (deadlock)** and **1205 (lock
   wait timeout)**. Read the code with `exc.orig.args[0]` on `sqlalchemy.exc.OperationalError`.
   **Nothing else may be retried** (retrying a business rejection like "Insufficient cash" would be wrong).
2. `run_in_transaction(fn, *, max_attempts=3, base_delay=0.05)`:
   - Opens a **fresh `SessionLocal()` per attempt**, calls `fn(db)`, commits, and always closes the session.
   - On any exception: `db.rollback()`. If retryable and attempts remain → sleep
     `base_delay * 2**attempt + random.uniform(0, base_delay)` and **restart `fn` from the beginning**.
     Otherwise re-raise.
   - The random jitter is required (without it two threads back off identically and collide again).
3. A small **module-level metrics object** (thread-safe, use a `threading.Lock`) counting:
   `attempts`, `retries`, `deadlocks`, `lock_timeouts`, `gave_up`. Expose `get_metrics()` and `reset_metrics()`.
4. `logging.getLogger("mockfolio.tx")`: log **every retry** at WARNING with attempt number and error code.

**Change `backend/trading.py` and `backend/main.py`:**
- Refactor `execute_trade` so it does **not** call `db.commit()` itself; the wrapper commits.
  Keep its signature usable by callers that pass a session, or add `execute_trade_tx(...)` that calls
  `run_in_transaction`. Keep the exact existing behaviour, fill maths and returned trade.
- In `main.py`, the `/trades/{side}` route must call the wrapper. Map errors:
  `TradingError` → 400 (unchanged, **never retried**); retries exhausted → **503** with body
  `{"detail": "Market is busy, please retry"}`; anything else → 500 (unchanged).
- The trade's `trade_json(...)` serialisation must happen **before the session closes**, or use
  `expire_on_commit=False` (already set) and read attributes safely.

**Fix the deadlock root cause too** (do both; retry is the safety net, this removes most occurrences):
- Take the account lock first, then acquire the holding lock **without** a gap lock on a missing row.
  The simplest correct approach: for a BUY where no holding exists, insert the holding with
  `INSERT … ON DUPLICATE KEY UPDATE` semantics, or pre-create nothing and catch the duplicate.
  Whatever you choose, **document it in a code comment** and keep the lock order stock → account → holding
  exactly as it is now (do not reorder existing locks).

**Acceptance checks (must all pass):**
- [ ] `pytest` still passes.
- [ ] New test `tests/test_transactions.py` (unit): `is_retryable` returns True for 1213/1205 and False for
      `TradingError`, `IntegrityError`, and a generic `Exception`.
- [ ] Concurrency test (see Task 6): 8 threads × 15 BUY orders across 5 stocks, repeated 5 rounds →
      **0 orders lost to deadlock** (baseline before this task: ~43 lost of 590).
- [ ] Money invariant still holds exactly (Task 6 helper).
- [ ] Metrics show retries > 0 in that run, proving the retry path was exercised.

---

## Task 2 — Make idempotency safe under a race

**Problem (verified):** 8 simultaneous requests with the *same* `client_order_key` → 1 succeeded,
**7 crashed with a raw `IntegrityError: Duplicate entry … for key 'orders.client_order_key'`**
(surfaces to the user as HTTP 500). The current "check then insert" is a race.

**Do:**
1. In the trade path, catch `IntegrityError` **specifically for the `client_order_key` unique index**.
   On that error: roll back, then in a **new** session look up the existing order by key and return its
   trade — i.e. behave exactly like the sequential-replay case (which already works).
2. Guard against **key reuse with a different payload**: if an existing order has the same key but
   different `user_id`, `stock_id`, `side`, or `quantity`, return **409** `{"detail": "Idempotency key reused with different request"}`.
   Never return another user's trade. Always scope the lookup with `Order.user_id == user_id`.
3. Do not let this path be retried by the deadlock retry loop.

**Acceptance checks:**
- [ ] Test: 8 simultaneous identical requests → exactly **1** `orders` row, **8 identical successful responses**, 0 HTTP 500.
- [ ] Test: same key, different quantity → 409.
- [ ] Test: same key from a different user → does not leak the first user's trade.

---

## Task 3 — Fix the decay endpoint's concurrency and access control

**Problems (verified / observed in `main.py`):**
- `POST /simulation/decay` locks **all** stock rows with `with_for_update()` and **deadlocked against
  concurrent trades** in testing.
- It is callable by **any logged-in user** (`Depends(current_user)`), and a normal user can call it
  repeatedly to move prices.
- It writes a `price_history` row for every stock on every call.

**Do:**
1. Restrict it to admins: `Depends(require_admin)`.
2. Move the logic into `backend/transactions.py`-style wrapped work: select stocks **`ORDER BY id`**
   and lock them in that fixed order, inside `run_in_transaction`, so it retries on deadlock.
3. Keep transactions **short**: read, compute with `decay_price`, write, commit. No sleeps/network inside.
4. Update `frontend/js/api.js` only if a UI currently calls this endpoint (search first).

**Acceptance checks:**
- [ ] Non-admin call → 403. Admin call → 200.
- [ ] Concurrency test: 6 trading threads + a decay loop running together → **0 unhandled errors**, money invariant holds.

---

## Task 4 — Lock-order helpers in one file + savepoints

**Goal:** Only one file is allowed to lock rows, in one agreed order, so the rule is enforceable and
demonstrable in the report.

**Create `backend/locks.py`** containing the *only* row-locking code:
- `lock_stock(db, stock_id)`, `lock_account(db, user_id)`, `lock_holding(db, user_id, stock_id)` — each a
  `SELECT … FOR UPDATE`.
- A module docstring stating the canonical order: **stock → account → holding**. For multi-stock
  operations (decay, resets), lock stocks in **ascending `id`** order.
- A module-level flag `LOCKING_ENABLED = True` and `ORDERING_ENABLED = True` (used by Task 7's
  "turn it off" demos). When `LOCKING_ENABLED` is False the helpers use plain `SELECT` (no `FOR UPDATE`).
  Default must be **True**; read from env var `MOCKFOLIO_LOCKING` (`on`/`off`) so production behaviour is unchanged.

**Change `trading.py`** to call these helpers instead of inline `with_for_update()`. Behaviour must be identical.

**Savepoints:** add `savepoint(db)` context manager (wraps `db.begin_nested()`). Use it in
`execute_trade` around the *price update + holding change + trade insert* block so that a failure there
can roll back that part without discarding the earlier order/lock work, then re-raise. Add a short test
proving a failure inside the savepoint leaves cash/holdings unchanged.

**Acceptance checks:**
- [ ] `grep -rn "with_for_update" backend/` matches **only** `backend/locks.py`.
- [ ] All previous tests + concurrency tests still pass with `MOCKFOLIO_LOCKING=on`.
- [ ] Unit test for the savepoint rollback.

---

## Task 5 — Database transaction settings and deadlock logging

**Do:**
1. In `backend/database.py`, set on connect (SQLAlchemy `connect` event):
   `SET SESSION innodb_lock_wait_timeout = 5` (short, so lock waits fail fast instead of hanging).
   Make the value configurable via env `LOCK_WAIT_TIMEOUT` (default 5).
2. Add an optional env `TX_ISOLATION` (default `REPEATABLE READ`, allowed: `READ COMMITTED`,
   `REPEATABLE READ`, `SERIALIZABLE`) applied through `create_engine(..., isolation_level=...)`.
   Validate the value against the allowed list; refuse to start on anything else.
3. Pool: `pool_size=12, max_overflow=4, pool_recycle=1800` (keep `pool_pre_ping=True`).
4. Add `sql/setup_notes.md` (or extend README) with the one-time server settings a developer should run:
   `SET GLOBAL innodb_print_all_deadlocks = ON;` and how to read the deadlock report with
   `SHOW ENGINE INNODB STATUS\G`.
5. Add a **read-only admin endpoint** `GET /admin/tx-metrics` (admin only) returning `get_metrics()` from Task 1.

**Acceptance checks:**
- [ ] `SELECT @@innodb_lock_wait_timeout` inside an app session returns the configured value.
- [ ] Setting `TX_ISOLATION=BOGUS` makes startup fail with a clear message.
- [ ] `GET /admin/tx-metrics` → 403 for normal user, JSON counters for admin.

---

## Task 6 — Concurrency test suite (the evidence for the report)

**Create `tests/concurrency/`** with a `conftest.py` and these tests. They must use **real threads,
each with its own DB session**, against a **dedicated test database** (e.g. `mockfolio_test`,
selected via env `TEST_DATABASE_URL`). **Refuse to run** if `TEST_DATABASE_URL` is unset or equals the
main `DATABASE_URL` — the helpers truncate tables.

**Shared helpers (`tests/concurrency/helpers.py`):**
- `reset_db()` — truncate `audit_log, trades, orders, holdings, price_history, watchlist, accounts, users`
  (with `FOREIGN_KEY_CHECKS=0` around it), reset `stocks.simulated_price = reference_price`.
- `make_users(n, cash="100000.00")`.
- `money_invariant(user_ids)` — assert
  `sum(cash) == n*starting_cash − Σ(BUY: fill*qty+brokerage) + Σ(SELL: fill*qty−brokerage)` **exactly** (Decimal),
  and that no account has `cash_balance < 0` and no holding has `quantity <= 0`.
- `run_workers(specs)` — start threads, join, return counts of ok / rejected / errors.

**Tests to write:**
1. `test_money_conserved_mixed_load` — 8 users × 40 random BUY/SELL over 5 stocks. Invariant holds; 0 unhandled errors.
2. `test_no_orders_lost_to_deadlock` — the Task 1 acceptance run (8×15 BUY, 5 rounds). Assert lost == 0.
3. `test_idempotent_double_click` — Task 2 acceptance run.
4. `test_no_negative_cash_when_oversubscribed` — one user with small cash fires many concurrent BUYs that
   together exceed the balance. Exactly the affordable ones fill; cash never goes negative.
5. `test_no_short_selling_race` — one user holds 10 shares, 5 threads each SELL 10 at once. Exactly 1 fills; holding ends at 0 / row removed.
6. `test_trades_with_decay` — Task 3 acceptance run.

**Acceptance checks:**
- [ ] `pytest tests/concurrency -q` passes, and is **repeatable** (run it 3 times in a row; concurrency bugs are random, one green run proves nothing).
- [ ] The suite prints a one-line summary: orders filled, retries used, deadlocks seen, elapsed seconds.

---

## Task 7 — "Turn it off" demos for the report (lost update, deadlock, isolation levels)

These produce the numbers a DBMS report needs. Build them as a script `scripts/concurrency_report.py`
that writes results to `reports/concurrency_results.json` and prints a readable table. It uses the
switches from Task 4/5 (`MOCKFOLIO_LOCKING`, `TX_ISOLATION`) — **never edit trading code to run a demo.**

1. **Lost update demo.** Many simultaneous BUYs on one account. Run **N=5 times each** with
   `MOCKFOLIO_LOCKING=on` and `off`. Report: final cash vs expected cash, and the dollar (rupee) discrepancy.
   With locking **off** the discrepancy must be non-zero on at least some runs; **on** must be exactly 0.
2. **Deadlock demo.** Two threads buying the same two stocks in opposite order with ordering **disabled**
   (`ORDERING_ENABLED=False` path) → capture MySQL's own `SHOW ENGINE INNODB STATUS` deadlock section to
   `reports/deadlock_capture.txt` *immediately* when a deadlock is detected (it can't be reproduced verbatim later).
   Then re-run with ordering **on** → 0 deadlocks.
3. **Isolation comparison.** Same workload at `READ COMMITTED`, `REPEATABLE READ`, `SERIALIZABLE`,
   5 runs each, **reset the DB between runs and change one variable at a time**. Report throughput
   (orders/sec), mean latency, deadlocks, retries. Add a 3–5 line written explanation of why they differ.
4. Record everything to the JSON file; include timestamp, MySQL version, thread count.

**Acceptance checks:**
- [ ] `python scripts/concurrency_report.py` runs unattended and produces both files.
- [ ] Results show locking-off ≠ locking-on, and ordering-off produces ≥1 deadlock across runs.

---

## Task 8 — Crash-recovery demonstration (durability)

**Do:** a script `scripts/crash_recovery_demo.py`:
1. Start the API as a subprocess, fire a batch of ~200 orders via HTTP from a few threads.
2. **Kill the app process (not the database)** mid-batch (`SIGKILL`).
3. Restart the app. Assert: every order the client saw a success for is present in `orders`+`trades`;
   no order exists without its trade (and vice-versa); the money invariant still holds.
4. Print a PASS/FAIL summary.

**Acceptance check:** [ ] Script prints PASS on three consecutive runs.

---

## Task 9 — Close the smaller DBMS gaps found in the audit

These are cheap and each maps to something the workflow document lists.

1. **Audit trigger coverage.** `sql/triggers.sql` only has `AFTER UPDATE` on `holdings`; first buys
   (INSERT) and full sells (DELETE) are never audited. Add `AFTER INSERT` and `AFTER DELETE` triggers with
   the same `audit_log` shape (`HOLDING_CREATE` / `HOLDING_DELETE`, old/new quantity). Keep them tiny —
   they run inside the trade transaction. Re-apply with `SOURCE sql/triggers.sql` and add a SQL test.
2. **Reset procedures & audit.** `reset_user_account` deletes `trades`/`orders` — verify it also leaves
   `audit_log` intact (it must not cascade). Add a SQL test showing that.
3. **Pagination with a hard cap.** `GET /orders`, `GET /trades`, `GET /stocks/{id}/history` and the admin
   list endpoints return unbounded lists. Add `limit` (default 50, **max 200**) and `offset` query params.
   Keep the default response shape a plain list so the current frontend keeps working.
4. **Index evidence.** Run `EXPLAIN` on the order-history query (`user_id` + `ORDER BY created_at DESC`)
   and the chart query (`stock_id` + `recorded_at`). Add a composite index
   `orders(user_id, created_at)` and `trades(user_id, created_at)` if `EXPLAIN` shows a filesort. Save the
   before/after `EXPLAIN` output to `reports/index_evidence.md`.
5. **Rejected orders (decision).** Currently a rejected trade leaves **nothing behind**. Keep that, but
   **document it explicitly** in the README ("a rejection rolls back completely and writes no order row").
6. **Startup safety.** `auth.py` falls back to a hard-coded JWT secret if `JWT_SECRET` is unset. Make the
   app **refuse to start** if `JWT_SECRET` is unset or still the placeholder value.
7. **CORS from env.** Read allowed origins from `CORS_ORIGINS` (comma-separated) with the current two
   localhost values as the default. (Do not deploy — this is only so config isn't hard-coded.)

**Acceptance checks:** [ ] `pytest` passes; [ ] each item above has a test or a saved artefact.

---

## Task 10 — Final verification and report-ready summary

1. Run the full suite: `pytest` and `pytest tests/concurrency` **three times**.
2. Re-run `python scripts/concurrency_report.py` and `python scripts/crash_recovery_demo.py`.
3. Write `docs/TRANSACTION_CONTROL.md` covering: the lock order and why; the gap-lock deadlock and how
   it was found and fixed (quote the captured deadlock report); the retry policy; the idempotency design;
   isolation-level results table; the crash-recovery result; and honest **limitations** (e.g. single MySQL
   node, no distributed transactions, decay is admin-triggered not scheduled).
4. Update the README "BUY and SELL transaction flow" and "Known limitations" sections to match reality.

**Definition of done for the whole file:** every box above is ticked, `pytest tests/concurrency` is green
three times running, and `docs/TRANSACTION_CONTROL.md` exists with real measured numbers.

---

## Appendix A — Baseline numbers measured before any of this work

Recorded so Claude Code (and your report) can show a real before/after. MySQL 8.0.46, REPEATABLE READ,
8 threads, each with its own connection, project code unmodified.

| Test | Result |
|---|---|
| Money conservation, mixed BUY/SELL, 8 users × 40 ops | ✅ exact (diff 0.00), 0 negative cash, 0 bad quantities |
| BUY-only, 8 users × 15 ops × 5 rounds (590 orders) | ❌ **43 lost to deadlock (7.3%)**, none retried |
| Idempotency, 8 simultaneous same-key requests | ❌ 1 ok, **7 raw `IntegrityError`** (HTTP 500) |
| Trades running alongside `POST /simulation/decay` | ❌ deadlock observed |
| Same BUY-only load **with retry added externally** | ✅ **0 lost of 590**, retries 3–10 per round, money still exact |

The last row is a proof-of-concept run outside the repo showing Task 1's approach works.

## Appendix B — Things to leave alone
The following already work and were verified; do not rewrite them: price-impact maths and cap,
brokerage, weighted-average buy price, BUY/SELL business rules (no shorting, insufficient cash/shares),
JWT auth and admin gating, developer accounts blocked from trading (HTTP 403), the frontend's per-request
`crypto.randomUUID()` idempotency key and its `finally { button.disabled = false }` handling.
