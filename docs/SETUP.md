## Setup

1. Install MySQL 8 and create a user, then run these commands in MySQL Workbench or the MySQL client:

```sql
CREATE DATABASE mockfolio CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'mf_app'@'%' IDENTIFIED BY 'change-me';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON mockfolio.* TO 'mf_app'@'%';
CREATE USER 'mf_migrate'@'%' IDENTIFIED BY 'change-me-too';
GRANT ALL PRIVILEGES ON mockfolio.* TO 'mf_migrate'@'%';
SET PERSIST log_bin_trust_function_creators = 1;
```

The last line is needed to create triggers when binary logging is on; without
it `sql/triggers.sql` fails with `ERROR 1419`. Then load the schema in order
(the files carry no `USE`, so the database name goes on the command line):

```bash
for f in schema triggers views procedures seed migrate_006_orders migrate_007_universe; do
  mysql -u mf_migrate -p mockfolio < "sql/$f.sql"
done
```

`scripts/reset_db.sh <database>` does all of the above in one command and
prints the row counts. It refuses to touch `DB_NAME` without `--force`,
because that is the database holding your demo data.

2. Install Python dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Set `DATABASE_URL` and `JWT_SECRET` in `.env`. The default URL matches the sample MySQL user. `JWT_SECRET` must be a real value — the app refuses to start if it's unset or left as one of the placeholder strings from `.env.example`.

To provision the local developer account, also set `DEV_USERNAME`, `DEV_EMAIL`, and `DEV_PASSWORD`. The backend creates the account on startup if it does not exist and marks it `ADMIN`; the password is never returned by an API or placed in frontend code.

Optional environment variables (all have working defaults): `CORS_ORIGINS` (comma-separated allowed origins; empty by default because the API serves the frontend on the same origin — only needed if you host the frontend separately), `LOCK_WAIT_TIMEOUT` (seconds, default 5), `TX_ISOLATION` (`READ COMMITTED` / `REPEATABLE READ` [default] / `SERIALIZABLE` — anything else refuses to start), `MOCKFOLIO_LOCKING` and `MOCKFOLIO_ORDERING` (`on` [default] / `off`, used only by `scripts/concurrency_report.py`'s demos — never set `off` outside that script), and `TEST_DATABASE_URL` (a separate, disposable MySQL database — required only for `pytest tests/concurrency` and the `scripts/*.py` demos, and must not equal `DATABASE_URL`, since those tests truncate tables).

3. Run the app from the project root:

```bash
uvicorn backend.main:app --reload
```

4. Visit `http://127.0.0.1:8000/login.html`. One process serves both the API
and the frontend: `backend/main.py` mounts `frontend/` at `/`, so the browser
and the API share an origin and `frontend/js/api.js` uses a relative
`API_BASE`. If you prefer a standalone frontend server, run
`python -m http.server 5500 -d frontend`; the API client automatically targets
port 8000 in that mode.

5. Run the unit checks:

```powershell
pytest
```

The interactive API documentation is at `http://localhost:8000/docs`.

For hosting, see `docs/RAILWAY_DEPLOYMENT.md`.

## Price impact

For a trade, `impact = min(0.08 * sqrt(quantity / average_daily_volume), 0.05)`. BUY uses `price * (1 + impact)` and SELL uses `price * (1 - impact)`. Fill price is the resulting simulated price. Brokerage is 0.1% of transaction value. Price decay uses `price + (reference - price) * 0.03`; call `POST /simulation/decay` to demonstrate it.

## BUY and SELL transaction flow

`backend/trading.py::execute_trade` locks the stock, then the account, then (SELL only) the holding — always in that order, via the single file allowed to take row locks, `backend/locks.py`. It validates cash/shares, then mutates cash/holding/stock price/trade together inside a SQL `SAVEPOINT` (`backend/transactions.py::savepoint`), after the `Order` row is created and flushed, so a failure in that inner block can be rolled back without discarding the order/lock work that came before it. `POST /trades/{side}` runs the whole thing through `execute_trade_tx`, which retries automatically on a real MySQL deadlock or lock-wait timeout (`backend/transactions.py::run_in_transaction`) with jittered exponential backoff, and never retries a business rejection. A rejected trade (insufficient cash or shares) still rolls back completely and writes no order row — by design, not a bug: there is no audit trail for a request that was never actually accepted.

`client_order_key` makes repeated submissions idempotent, including under a real race: two simultaneous requests with the same key resolve to the same trade (never a raw 500), and reusing a key with a different quantity/side/stock/user is rejected with 409 rather than silently returning someone else's trade.

The first-time-BUY path historically had a real gap-lock deadlock at REPEATABLE READ (fixed with `INSERT ... ON DUPLICATE KEY UPDATE` instead of `SELECT ... FOR UPDATE` + `INSERT`), and `POST /simulation/decay` (admin-only) locks all stocks in ascending `id` order so it can't deadlock against a trade or against itself. All of this — the lock order, the deadlock fix, the retry policy, the idempotency design, an isolation-level comparison, a lost-update demonstration, and a crash-recovery test, all with real numbers from real MySQL — is written up in `docs/TRANSACTION_CONTROL.md`.

## API

- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- `GET /stocks`, `GET /stocks/{id}`, `GET /stocks/{id}/history` (paginated, see below)
- `POST /trades/buy`, `POST /trades/sell`
- `GET /portfolio`, `GET /portfolio/summary`
- `GET /orders`, `GET /trades` (paginated, see below)
- `GET/POST/DELETE /watchlist`
- `POST /simulation/decay` (admin-only)
- Admin-only `GET /admin/summary`, `GET /admin/users` (paginated), `GET /admin/users/{id}`, `GET /admin/users/{id}/trades` (paginated), `GET /admin/users/{id}/orders` (paginated), `POST /admin/reset-market`, `POST /admin/reset-user/{id}`, and `GET /admin/tx-metrics` (deadlock/retry counters)

Paginated endpoints accept `limit` (default 50, max 200 — a higher value is rejected with 422, not silently clamped) and `offset` query params, and still return a plain list by default so existing callers are unaffected.

The frontend pages are `index.html` (market), `stock.html` (trade detail), `watchlist.html`, `portfolio.html`, `orders.html`, `profile.html`, `developer.html`, and `developer-user.html`. BUY and SELL confirmations use the authoritative backend response and refresh the simulated price/chart without a browser reload.

## Theme and developer access

The light/dark preference is stored in browser `localStorage` under `mockfolio-theme` with values `light` or `dark`. It applies before the stylesheet loads, persists across pages and refreshes, and re-themes the Lightweight Charts when changed.

The developer dashboard is available only to users whose database `is_admin` flag is true. The backend `require_admin` dependency protects every `/admin/*` route; hiding the navigation link is only a convenience. Developers can inspect safe user summaries, holdings, trades, and orders. This is local educational functionality, not a production administration system.