# Transaction control in MockFolio

This documents what was actually built and measured for the transaction-control
work on this project (Tasks 1-9 of `MOCKFOLIO_REMAINING_TASKS.md`), with real
numbers from real MySQL 8.0.39 runs, not projected or hypothetical ones.

## Lock order, and why

Canonical order, enforced in the one file allowed to take row locks
(`backend/locks.py`): **stock → account → holding**. For operations that touch
multiple stocks (currently only `POST /simulation/decay`), stocks are locked in
**ascending `id`** order.

A fixed lock order is what actually prevents deadlocks between transactions
that lock more than one row: if every transaction always requests locks A→B→C
in that order, no transaction can be holding B while waiting for A, so no
circular wait — and no deadlock — is possible between them. `execute_trade`
locks the stock, then the account, then (for SELL only) the holding, in that
order, every time. Multi-stock operations sort by `id` first for the same
reason.

## The gap-lock deadlock: how it was found, and how it was fixed

**How it was found.** Before this work, `execute_trade`'s BUY path did:

```python
holding = db.scalar(select(Holding).where(...).with_for_update())
...
if holding: ... else: db.add(Holding(...))
```

Running the real, unmodified code against real MySQL 8 with real concurrent
threads showed **43 of 590 orders (7.3%) lost to deadlock** under modest
concurrent buying — not a rare edge case, a routine one. MySQL's own deadlock
report from that investigation showed the mechanism: a `SELECT ... FOR UPDATE`
against a `(user_id, stock_id)` row that doesn't exist yet takes a **gap lock**
on the index gap at REPEATABLE READ. Two concurrent *first buys* of the same
stock both take that gap lock, then both try to `INSERT` into it, and each
waits on the other — MySQL detects the cycle and kills one side with error
1213 (`INSERT INTO holdings ... waiting for insert-intention lock ... WE ROLL
BACK TRANSACTION`).

**How it was fixed.** `backend/trading.py`'s `_upsert_buy_holding` replaced the
`SELECT ... FOR UPDATE` + `INSERT`/`UPDATE` pair with a single
`INSERT ... ON DUPLICATE KEY UPDATE` statement. This lets MySQL resolve
new-row-vs-existing-row atomically in one statement, so **no gap lock is ever
taken on a missing holdings row** — the root cause is gone, not just retried
around. The weighted-average-price math runs inside the `UPDATE` clause, where
`average_buy_price` is evaluated before `quantity` is overwritten later in the
same clause, so it still sees the pre-trade quantity. SELL still locks the
holding directly with `SELECT ... FOR UPDATE`, since a SELL's holding must
already exist (a nonexistent one is a straightforward business rejection, not
a gap-lock hazard).

**Proof the fix works, and proof the retry path still works.** Running
`tests/concurrency/test_no_orders_lost_to_deadlock` (8 threads × 15 BUY orders
× 5 rounds, ~600 orders, against real MySQL) after the fix: **0 orders lost**,
money invariant exact, **0 retries measured** — the fix eliminated the
deadlock rather than merely surviving it, since a pure-BUY workload can no
longer take the one lock that caused it, and the remaining stock→account
locking is provably deadlock-free by the fixed-order argument above. Since
that means this specific workload can no longer *exercise* the retry path, a
second test, `test_run_in_transaction_retries_a_real_deadlock`, deliberately
breaks the canonical order between two threads (locking two stocks in opposite
order — something the app itself never does) purely to generate a real 1213
and confirm the retry path clears it. Real captured log line:

```
WARNING mockfolio.tx: retrying transaction after mysql error 1213 (attempt 1/5)
```

And an excerpt of the real `SHOW ENGINE INNODB STATUS` deadlock section this
produced (full copy in `reports/deadlock_capture.txt`):

```
*** (1) TRANSACTION:
...
SELECT stocks.id, ... FROM stocks WHERE stocks.id = 2 FOR UPDATE

*** (1) HOLDS THE LOCK(S):
RECORD LOCKS space id 99 page no 4 ... table `mockfolio_test`.`stocks` ... lock_mode X locks rec but not gap
... (RELIANCE row)

*** (1) WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 99 page no 4 ... table `mockfolio_test`.`stocks` ... lock_mode X locks rec but not gap waiting
... (TCS row)
```

This is a *different* deadlock shape than the original one (a plain lock-order
cycle on two ordinary row locks, not a gap lock on a missing row) — it exists
here specifically to prove `run_in_transaction`'s retry path against a real
MySQL deadlock, now that the original bug can no longer be reproduced.

## Retry policy

`backend/transactions.py::run_in_transaction`:
- Opens a **fresh `SessionLocal()` per attempt** (never reuses a session across
  retries, so a failed attempt can't leak half-mutated state into the next one).
- `is_retryable(exc)` is `True` **only** for MySQL 1213 (deadlock) and 1205
  (lock-wait timeout) on a `sqlalchemy.exc.OperationalError` — a `TradingError`
  (business rejection), an `IntegrityError` (e.g. a duplicate idempotency key),
  or any other exception is never retried.
- On a retryable failure, sleeps `base_delay * 2**attempt + random.uniform(0,
  base_delay)` (default `base_delay=0.05`) before restarting the attempt from
  scratch. The random jitter matters: without it, two threads that just
  deadlocked would back off by the identical amount and collide again.
- Every retry is logged at WARNING on the `mockfolio.tx` logger with the
  attempt number and MySQL error code.
- A thread-safe metrics counter (`attempts`, `retries`, `deadlocks`,
  `lock_timeouts`, `gave_up`) is exposed at `GET /admin/tx-metrics`
  (admin-only).
- `/trades/{side}` maps a `TradingError` to 400 (unchanged, never retried), an
  exhausted-retry error to 503 `{"detail": "Market is busy, please retry"}`,
  and anything else to 500.

## Idempotency design

`client_order_key` is a globally unique column on `orders`. The **sequential
replay** case (same key submitted again after the first request already
completed) was already correct before this work: look the order up by key,
return its trade.

The **race** case wasn't: two simultaneous requests with the same key could
both pass the "does it exist yet" check before either had inserted, and the
loser crashed with a raw `IntegrityError: Duplicate entry ... for
key 'orders.client_order_key'` (an HTTP 500). Fixed by:
- `execute_trade_tx` catches `IntegrityError`, and — only when
  `_is_duplicate_client_order_key()` confirms it's specifically the
  `client_order_key` unique index, not some unrelated constraint — resolves it
  in a **fresh session**, replaying the exact same lookup the sequential case
  uses, so the loser gets the winner's trade back instead of a 500.
  `IntegrityError` is outside `is_retryable()`'s scope, so this path is never
  retried by `run_in_transaction`.
- **Key reuse with a different payload** (same key, different `user_id`,
  `stock_id`, `side`, or `quantity`) raises `IdempotencyConflict` → HTTP 409
  `{"detail": "Idempotency key reused with different request"}`, and the
  lookup is always scoped so a different user's trade is never returned. This
  closed a latent bug in the *original* code too: it returned the existing
  trade on any key match with no payload or user check at all.

Verified against real MySQL: 8 simultaneous identical requests → exactly 1
`orders` row, all 8 calls resolve to the same trade, 0 HTTP 500s; a repeat
with a different quantity → `IdempotencyConflict`/409, still exactly 1 order
row; a repeat from a different user → `IdempotencyConflict`/409, the original
user's order and trade untouched.

## Isolation-level comparison

Same workload (8 users × 10 orders, mixed random BUY/SELL over 5 stocks), 5
runs per level, database reset between every run, one variable changed at a
time (`TX_ISOLATION` only — locking and ordering left at their defaults).
Measured against real MySQL 8.0.39 via `scripts/concurrency_report.py`:

| Isolation level | Throughput (orders/sec) | Mean latency | Deadlocks | Retries |
|---|---|---|---|---|
| READ COMMITTED | 43.4 - 80.5 (mean 67.7) | 565.8ms | 0 | 0 |
| REPEATABLE READ (default) | 65.8 - 80.4 (mean 75.1) | 458.7ms | 0 | 0 |
| SERIALIZABLE | 32.7 - 79.7 (mean 61.2) | 626.2ms | 0 | 0 |

Why they differ: READ COMMITTED sees the latest committed data on every
statement and takes the fewest gap locks, so it has the least blocking — the
mean here is close to REPEATABLE READ's but with wider spread, since without a
stable snapshot some runs saw more contention-driven waiting than others.
REPEATABLE READ (this project's default) holds a consistent snapshot and
takes gap locks for the whole transaction; this is exactly why the original
first-buy holdings deadlock existed at this level, and it was the most
*consistent* performer here since every trade already does `SELECT ... FOR
UPDATE` regardless of isolation level. SERIALIZABLE additionally takes shared
locks on plain `SELECT`s, closer to fully serializing readers and writers of
the same rows; since this workload already does `SELECT ... FOR UPDATE` on
every write, the extra overhead over REPEATABLE READ is smaller than it would
be for a read-heavy workload, but it was still the slowest and highest-latency
of the three, as expected. No deadlocks or retries occurred at any level at
this workload size and 8-thread concurrency.

## Lost-update demonstration

One account, 10 concurrent BUYs of the same stock, 5 runs per configuration
(`scripts/concurrency_report.py`, real MySQL):

| `MOCKFOLIO_LOCKING` | Cash discrepancy across 5 runs |
|---|---|
| `off` | `1401.51`, `2803.02`, `1401.51`, `2803.02`, `1401.51` (never zero) |
| `on` (default) | `0.00`, `0.00`, `0.00`, `0.00`, `0.00` |

With locking disabled, `lock_account`'s plain `SELECT` lets multiple
concurrent transactions read the same starting `cash_balance` under
REPEATABLE READ's snapshot, each compute a new balance from that same stale
value, and whichever commits last silently overwrites the others' deductions
— a textbook lost update. A secondary, more dramatic finding from the same
investigation: with locking off and enough contention on the exact same
holdings row, some requests instead failed outright with a raw
`OperationalError: SAVEPOINT ... does not exist`, rather than just losing an
update silently. Confirmed this specific failure mode is impossible with
locking on (the default): the account lock, taken before the savepoint in
`execute_trade`, fully serializes any given user's trades, so two
transactions can never be inside the holdings-upsert savepoint for the same
holding at the same time.

## Crash-recovery (durability) result

`scripts/crash_recovery_demo.py`: starts the real API, fires ~200 BUY orders
over real HTTP from 8 threads, `SIGKILL`s the app process (never the
database) once roughly 40% of requests have actually been attempted,
restarts the app against the same database, then verifies directly against
it. Real result, confirmed on 3 consecutive runs with identical numbers each
time:

- 88 of 200 requests were attempted before the connection died; **80** got a
  definitive HTTP 200.
- All 80 client-successful orders are present in `orders`, each with exactly
  one matching row in `trades` — no orphans either direction.
- Money invariant exact: cash balance equals starting cash minus the sum of
  the 80 recorded trades' cost, to the paisa (`107583.69` in the measured
  runs).

This isn't a MySQL crash-recovery test — the database process was never
touched, only the application process. It demonstrates that transactional
atomicity does the actual work: an order the app never finished committing
before it died simply doesn't exist afterward (all-or-nothing), rather than
existing in some half-written state.

## Limitations

- **Single MySQL node.** No replication, no distributed transactions, no
  two-phase commit — everything here is one database, one instance. None of
  this generalizes to a sharded or multi-region deployment without further
  work.
- **Decay is admin-triggered, not scheduled.** `POST /simulation/decay` has to
  be called explicitly (by an admin, per Task 3); there is no background job
  or cron running it automatically. The lock-ordering and retry behavior is
  still real and tested, but the *timing* of when decay happens is a manual
  operational choice in this project, not an autonomous scheduler.
- **The idempotency key is a single unique column, not per-user-scoped in the
  schema.** The application layer enforces that a key can't be reused across
  users or with a different payload (see above), but the database constraint
  itself is a plain global unique index — a determined client could still
  exhaust the keyspace with garbage keys (not a concern at this project's
  scale, but worth naming).
- **Retry policy is fixed, not adaptive.** `max_attempts=3` and the backoff
  curve are constants, not tuned against production traffic patterns (there is
  no production traffic — this is a paper-trading mini-project).
- **The crash-recovery demo kills the app, not MySQL.** It proves application-
  level durability (a killed app process can't leave a half-committed trade
  behind) but says nothing about MySQL's own crash recovery (redo log replay
  after `kill -9 mysqld`), which was out of scope here and would need its own
  demonstration with a disposable MySQL instance.
- **All of the above numbers are from one machine, one MySQL instance, modest
  concurrency (single or double digits of threads).** They demonstrate the
  mechanisms work and behave in the expected direction, not a production
  capacity or SLA claim.
