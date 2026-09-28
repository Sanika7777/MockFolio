# MockFolio

https://github.com/user-attachments/assets/b5912bf8-7270-4e3f-b2ad-5161b7688fe2

MockFolio is a small DBMS mini-project for multi-user paper trading. It uses virtual cash and a deliberately explainable market simulation: a filled BUY moves a stock's simulated price upward, while a SELL moves it downward. Reference prices remain the baseline.

## DBMS concepts demonstrated

- Primary and foreign keys: every table in `sql/schema.sql`.
- Candidate/unique keys: usernames, emails, one account per user, one holding per user/stock, and client order keys.
- Constraints: nonnegative cash, positive holdings, enum sides, and foreign-key cascades.
- 3NF normalization: users, accounts, stocks, holdings, orders, trades, and history separate facts; orders reference users/stocks instead of duplicating names.
- ACID transactions, rollback, and savepoints: `backend/trading.py`, `backend/transactions.py`; procedures in `sql/procedures.sql`.
- Row-level locking, in one canonical order: `backend/locks.py` is the only file that calls `with_for_update()`.
- Deadlock retry with jittered backoff and metrics: `backend/transactions.py::run_in_transaction`, exposed at `GET /admin/tx-metrics`.
- Triggers: `sql/triggers.sql` writes `HOLDING_CREATE` (INSERT), `HOLDING_CHANGE` (UPDATE), and `HOLDING_DELETE` (DELETE) rows to `audit_log` — full CRUD coverage on `holdings`, not just updates.
- Views, joins, aggregation, and GROUP BY: `sql/views.sql` (`portfolio_view`, `account_summary_view`).
- Indexes: lookup and composite indexes in `sql/schema.sql`, including `orders`/`trades` composites added after measuring a real `EXPLAIN` filesort (see `reports/index_evidence.md`).
- Stored procedures: `reset_user_account` and `reset_market`.
- Transaction isolation levels, configurable and demonstrably different in practice: see `docs/TRANSACTION_CONTROL.md`.

## Known limitations and future improvements

This is an educational simulation, not a brokerage system. It has no live prices, WebSockets, payments, short selling, margin, or advanced orders. Price decay remains an explicit `POST /simulation/decay` operation (now admin-only) rather than a background scheduler. TradingView Lightweight Charts is loaded from its public CDN. The admin endpoints remain API-only; the normal user shell does not expose admin controls.

Transaction-control specific limitations (see `docs/TRANSACTION_CONTROL.md` for the full write-up): single MySQL node only, no replication or distributed transactions; the idempotency key is a single global unique column, not schema-enforced per user; the deadlock retry policy (3 attempts, exponential backoff with jitter) is a fixed constant, not tuned against real production traffic; and the crash-recovery demonstration kills the application process, not MySQL itself, so it proves application-level durability but says nothing about MySQL's own crash recovery.
