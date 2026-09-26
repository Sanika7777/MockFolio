# One-time MySQL server settings for transaction-control work

Run these once against your MySQL 8 server. They are server-level settings,
not schema, so they aren't in `sql/schema.sql` and don't need re-running per
database.

```sql
SET GLOBAL innodb_print_all_deadlocks = ON;
```

This makes every deadlock MySQL detects get written to the error log, not
just the single most recent one that `SHOW ENGINE INNODB STATUS` keeps.
Find your error log path with:

```sql
SHOW VARIABLES LIKE 'log_error';
```

## Reading a deadlock report

Immediately after a deadlock (the report is overwritten by the next one, so
capture it right away if you need it for evidence), or to see the most
recent one MySQL resolved:

```sql
SHOW ENGINE INNODB STATUS\G
```

Look at the `LATEST DETECTED DEADLOCK` section:
- `*** (1) TRANSACTION:` / `*** (2) TRANSACTION:` — the two transactions
  involved, and the statement each was running when it got stuck.
- `*** (1) WAITING FOR THIS LOCK TO BE GRANTED:` (and the `(2)` counterpart)
  — which lock each was blocked on. A `RECORD LOCK ... insert intention`
  entry is the gap-lock-then-insert pattern this project's first-buy path
  used to hit (see `docs/TRANSACTION_CONTROL.md` once Task 10 writes it, or
  `backend/trading.py`'s `_upsert_buy_holding` docstring for the fix).
- `*** WE ROLL BACK TRANSACTION (1)` (or `(2)`) — which side MySQL picked as
  the victim; that transaction gets MySQL error 1213 back.

## Related app settings (`backend/database.py`)

- `LOCK_WAIT_TIMEOUT` (default `5`) is applied per-connection as
  `SET SESSION innodb_lock_wait_timeout = <value>`. This bounds how long a
  transaction waits for a row lock before giving up with error 1205 — a
  different failure mode from a genuine deadlock (1213), but
  `backend/transactions.py`'s `run_in_transaction` retries both.
- `TX_ISOLATION` (default `REPEATABLE READ`; also accepts `READ COMMITTED`
  or `SERIALIZABLE`) is passed to SQLAlchemy's `create_engine(isolation_level=...)`.
  Any other value makes the app refuse to start.
