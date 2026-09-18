# MockFolio

MockFolio is a small DBMS mini-project for multi-user paper trading. It uses virtual cash and a deliberately explainable market simulation: a filled BUY moves a stock's simulated price upward, while a SELL moves it downward. Reference prices remain the baseline.

## Stack and structure

- Python, FastAPI, SQLAlchemy, PyMySQL, JWT, bcrypt
- MySQL 8+ with InnoDB
- Static HTML/CSS/vanilla JavaScript frontend
- `backend/` API and trading service, `sql/` database demonstrations, `frontend/` browser UI, `tests/` unit checks

## Setup

1. Install MySQL 8 and create a user, then run these commands in MySQL Workbench or the MySQL client:

```sql
CREATE USER 'mockfolio'@'localhost' IDENTIFIED BY 'mockfolio';
GRANT ALL PRIVILEGES ON mockfolio.* TO 'mockfolio'@'localhost';
SOURCE sql/schema.sql;
SOURCE sql/triggers.sql;
SOURCE sql/views.sql;
SOURCE sql/procedures.sql;
SOURCE sql/seed.sql;
```

2. Install Python dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Set `DATABASE_URL` and `JWT_SECRET` in `.env`. The default URL matches the sample MySQL user.

To provision the local developer account, also set `DEV_USERNAME`, `DEV_EMAIL`, and `DEV_PASSWORD`. The backend creates the account on startup if it does not exist and marks it `is_admin`; the password is never returned by an API or placed in frontend code.

3. Run the API from the project root:

```powershell
uvicorn backend.main:app --reload
```

4. Serve the frontend with `python -m http.server 5500 -d frontend` and visit `http://127.0.0.1:5500/login.html`. The frontend uses a centralized API client in `frontend/js/api.js` and talks to `http://127.0.0.1:8000`.

5. Run the unit checks:

```powershell
pytest
```

The interactive API documentation is at `http://localhost:8000/docs`.

## Price impact

For a trade, `impact = min(0.08 * sqrt(quantity / average_daily_volume), 0.05)`. BUY uses `price * (1 + impact)` and SELL uses `price * (1 - impact)`. Fill price is the resulting simulated price. Brokerage is 0.1% of transaction value. Price decay uses `price + (reference - price) * 0.03`; call `POST /simulation/decay` to demonstrate it.

## BUY and SELL transaction flow

`backend/trading.py` starts one SQLAlchemy transaction and locks the stock and account rows with `SELECT ... FOR UPDATE` via `with_for_update()`. SELL also locks the holding. It validates cash/shares, changes the account, holding, stock price, order, and trade together, then commits. Any exception rolls back, preventing negative balances, negative holdings, and lost price updates. `client_order_key` is unique to make repeated submissions idempotent.

## API

- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- `GET /stocks`, `GET /stocks/{id}`, `GET /stocks/{id}/history`
- `POST /trades/buy`, `POST /trades/sell`
- `GET /portfolio`, `GET /portfolio/summary`
- `GET /orders`, `GET /trades`
- `GET/POST/DELETE /watchlist`
- `POST /simulation/decay`
- Admin-only `GET /admin/summary`, `GET /admin/users`, `GET /admin/users/{id}`, `GET /admin/users/{id}/trades`, `GET /admin/users/{id}/orders`, `POST /admin/reset-market`, and `POST /admin/reset-user/{id}`

The frontend pages are `index.html` (market), `stock.html` (trade detail), `watchlist.html`, `portfolio.html`, `orders.html`, `profile.html`, `developer.html`, and `developer-user.html`. BUY and SELL confirmations use the authoritative backend response and refresh the simulated price/chart without a browser reload.

## Theme and developer access

The light/dark preference is stored in browser `localStorage` under `mockfolio-theme` with values `light` or `dark`. It applies before the stylesheet loads, persists across pages and refreshes, and updates the Chart.js axis styling when changed.

The developer dashboard is available only to users whose database `is_admin` flag is true. The backend `require_admin` dependency protects every `/admin/*` route; hiding the navigation link is only a convenience. Developers can inspect safe user summaries, holdings, trades, and orders. This is local educational functionality, not a production administration system.

## DBMS concepts demonstrated

- Primary and foreign keys: every table in `sql/schema.sql`.
- Candidate/unique keys: usernames, emails, one account per user, one holding per user/stock, and client order keys.
- Constraints: nonnegative cash, positive holdings, enum sides, and foreign-key cascades.
- 3NF normalization: users, accounts, stocks, holdings, orders, trades, and history separate facts; orders reference users/stocks instead of duplicating names.
- ACID transactions and rollback: `backend/trading.py`; procedures in `sql/procedures.sql`.
- Row-level locking: stock/account/holding `with_for_update()` calls in `backend/trading.py`.
- Trigger: `sql/triggers.sql` writes holding changes to `audit_log`.
- Views, joins, aggregation, and GROUP BY: `sql/views.sql` (`portfolio_view`, `account_summary_view`).
- Indexes: lookup and composite indexes in `sql/schema.sql`.
- Stored procedures: `reset_user_account` and `reset_market`.

## Demo flow

Register two users, open RELIANCE at its reference price, BUY a visible quantity, and show the simulated price, deviation, and trade impact. Open a second browser session to show the shared changed price. SELL from the first user's holding, then show portfolio P&L and inspect `portfolio_view`, `audit_log`, and the reset procedures in Workbench.

## Known limitations and future improvements

This is an educational simulation, not a brokerage system. It has no live prices, WebSockets, payments, short selling, margin, advanced orders, or production secret management. Price decay remains an explicit `POST /simulation/decay` operation rather than a background scheduler. Chart.js is loaded from its public CDN. The admin endpoints remain API-only; the normal user shell does not expose admin controls.
