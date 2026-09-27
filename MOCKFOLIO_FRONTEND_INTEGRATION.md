# MockFolio — Frontend Integration Guide (for Claude Code)

> **Your job:** take the redesigned HTML/CSS exported from Google Stitch and make it work with the
> existing FastAPI backend and the existing JavaScript, **without breaking any behaviour**.
> This is a **restyle + rewire**, not a rewrite. The current app works. Your job is to change how it looks.
>
> **How to use this file:** Read all of it once. Then do **Phase 0** and report back. Do one phase at a
> time and **stop after each phase** so the human can review in the browser before you continue.

---

## 0. Where everything lives (folder layout)

The human will put the Stitch export and the design system into the repo like this. **Read from `design/`, write into `frontend/`.**

```
MockFolio/
├── DESIGN.md                       ← design tokens (colours, type, spacing). Source of truth for CSS variables
├── frontend/                       ← THE LIVE APP. You edit this.
│   ├── *.html                      ← 10 real pages + dashboard.html (a redirect, leave it)
│   ├── css/style.css               ← current stylesheet (to be replaced/rebuilt)
│   └── js/
│       ├── api.js                  ← API client. DO NOT REPLACE (see §2)
│       ├── app.js                  ← all page logic. Edit carefully (see §3)
│       ├── auth.js                 ← login/register form logic
│       ├── theme.js                ← theme switching. Keep
│       └── dashboard.js / portfolio.js / stock.js   ← empty stubs, leave
├── design/                         ← READ-ONLY reference. The Stitch export.
│   ├── README.md                   ← (human-written) which file is which screen, any notes
│   ├── screens/
│   │   ├── register.mobile.light.html      ← naming: <screen>.<mobile|web>.<light|dark>.html
│   │   ├── register.web.light.html
│   │   ├── login.mobile.light.html  … etc.
│   │   └── (10 screens × mobile/web; dark can be a CSS theme swap, see §6)
│   ├── screenshots/                ← PNGs of each design, same names as above (visual target)
│   └── assets/                     ← any exported images/icons/fonts
└── backend/  sql/  tests/          ← DO NOT TOUCH in this task
```

**If `design/` is missing or empty, stop and tell the human.** Do not invent the design.

### Screen → live page map

| Stitch screen       | Live file             | `body data-page`       | JS loader in `app.js` |
| ------------------- | --------------------- | ---------------------- | --------------------- |
| Register            | `register.html`       | _(none, uses auth.js)_ | `auth.js`             |
| Login               | `login.html`          | _(none, uses auth.js)_ | `auth.js`             |
| Market              | `index.html`          | `market`               | `loadMarket()`        |
| Stock detail        | `stock.html`          | `stock`                | `loadStock()`         |
| Watchlist           | `watchlist.html`      | `watchlist`            | `loadWatchlist()`     |
| Portfolio           | `portfolio.html`      | `portfolio`            | `loadPortfolio()`     |
| Orders & trades     | `orders.html`         | `orders`               | `loadOrders()`        |
| Profile             | `profile.html`        | `profile`              | `loadProfile()`       |
| Developer dashboard | `developer.html`      | `developer`            | `loadDeveloper()`     |
| Developer → user    | `developer-user.html` | `developer-user`       | `loadDeveloperUser()` |

---

## 1. Ground rules (non-negotiable)

1. **Never rename or remove an ID or `data-*` attribute listed in §3.** The JS finds elements by them. A missing ID fails silently.
2. **Do not replace `js/api.js`.** Stitch will not export it. It is the only file that talks to the backend.
3. **Do not touch `backend/`, `sql/`, `tests/`.** If a design needs data the API doesn't have, follow §8. Never edit the backend to suit a design.
4. **Keep it plain HTML + CSS + vanilla JS + Chart.js.** No React, no bundler, no Tailwind build step, no npm dependencies for the frontend.
5. **Escape all API data** with the existing `escapeHTML()` before putting it in `innerHTML`. Never interpolate raw API strings.
6. **Money is displayed with `api.formatINR`** (Indian grouping, `₹`). Don't re-implement it.
7. **Keep the page working with JS disabled being irrelevant** — but keep every page usable with the keyboard and screen readers (§9).
8. **Do not commit `.env`, tokens, or the `design/` screenshots if they are huge.** Ask before adding binary files over 1 MB.
9. After **each phase**: run the app, load the pages named in that phase, and report exactly what you checked and what you could not check.

---

## 2. How the frontend talks to the backend (the contract)

**Serving:** the backend serves the frontend at `http://127.0.0.1:8000` in the normal setup. For a separate static server, serve the frontend on port 5500; `api.js` then targets the backend automatically. Set `CORS_ORIGINS` to the frontend origin when using a separate server:

```
python -m http.server 5500 -d frontend
```

**Use port 5500 exactly for the automatic local API target.** Other frontend origins require a matching `CORS_ORIGINS` value and an explicit `window.MOCKFOLIO_API_BASE` override if needed.

**Auth:** login/register return `{ "access_token": "..." }`. It is stored in `localStorage["token"]`. Every request sends `Authorization: Bearer <token>`. A **401** clears the token and redirects to `login.html`. `app.js` redirects to `login.html` immediately if there is no token.

**Endpoints and the fields the UI reads** (only use these; the API is fixed):

| Call (`MockfolioApi.…`)                                    | Endpoint                                             | Fields the UI uses                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `login(d)` / `register(d)`                                 | `POST /auth/login`, `/auth/register`                 | send `{username,password}` / `{username,email,password}` → `access_token`                                                                                                                                                                                                        |
| `me()`                                                     | `GET /auth/me`                                       | `id, username, email, is_admin, created_at, cash_balance` (**no `name` field**: the UI falls back to `username`, so a "Hi, Ananya" greeting must use `username`)                                                                                                                 |
| `stocks()`                                                 | `GET /stocks`                                        | `id, symbol, company_name, sector, reference_price, simulated_price, deviation, deviation_percentage`                                                                                                                                                                            |
| `stock(id)`                                                | `GET /stocks/{id}`                                   | same fields as above                                                                                                                                                                                                                                                             |
| `history(id)`                                              | `GET /stocks/{id}/history`                           | newest-first, **max 100** rows: `reference_price, simulated_price, deviation, deviation_percentage, recorded_at`                                                                                                                                                                 |
| `portfolio()`                                              | `GET /portfolio`                                     | `symbol, stock_id, quantity, average_buy_price, simulated_price, invested_value, current_value, profit_loss` (**no `sector`**)                                                                                                                                                   |
| `summary()`                                                | `GET /portfolio/summary`                             | `cash_balance, holdings_value, total_account_value, total_pnl`                                                                                                                                                                                                                   |
| `orders()`                                                 | `GET /orders`                                        | `created_at, symbol, order_type, quantity, requested_price, status`                                                                                                                                                                                                              |
| `trades()`                                                 | `GET /trades`                                        | `created_at, symbol, side, quantity, fill_price, brokerage, price_impact`                                                                                                                                                                                                        |
| `watchlist()` / `addWatchlist(id)` / `removeWatchlist(id)` | `GET/POST/DELETE /watchlist[/id]`                    | list of stocks (same shape as `/stocks`)                                                                                                                                                                                                                                         |
| `trade(side, body)`                                        | `POST /trades/buy` or `/sell`                        | send `{stock_id, quantity, client_order_key}` → `fill_price, total_cost, brokerage, price_before, price_after, price_impact, deviation_after_trade`                                                                                                                              |
| `adminSummary()`                                           | `GET /admin/summary`                                 | `total_users, total_trades, total_orders, active_stocks`                                                                                                                                                                                                                         |
| `adminUsers()`                                             | `GET /admin/users`                                   | list of `id, username, email, created_at, cash_balance, portfolio_value, total_pnl, trade_count`                                                                                                                                                                                 |
| `adminUser(id)`                                            | `GET /admin/users/{id}`                              | **nested**, not flat: `{ user: {id, username, email, is_admin, created_at}, account: {cash_balance, portfolio_value, total_account_value, total_pnl, trade_count}, holdings: [{stock_id, symbol, company_name, quantity, average_buy_price, simulated_price, profit_loss, …}] }` |
| `adminUserTrades(id)` / `adminUserOrders(id)`              | `GET /admin/users/{id}/trades                        | orders`                                                                                                                                                                                                                                                                          | as trades / orders above |
| `resetMarket()` / `resetUser(id)`                          | `POST /admin/reset-market`, `/admin/reset-user/{id}` | admin-only, destructive                                                                                                                                                                                                                                                          |

**Errors are already translated** to friendly text in `api.js` (`getErrorMessage`). Show `error.message` as-is. Do not invent new error strings.

**Trade idempotency (do not break):** every trade submit sends `client_order_key: crypto.randomUUID()` and the submit button is disabled while the request runs and re-enabled in a `finally` block. Keep both. Losing either allows double-orders on a double-click.

---

## 3. DOM contract: IDs, hooks and classes the JS depends on

There are **two places** the markup comes from, and you must update **both**:

- **A. Static HTML files** (`frontend/*.html`): page skeleton, headings, toolbar, table headers, empty containers.
- **B. HTML template strings inside `app.js`**: the JS builds the rows, cards, nav bar, stock header, trade panel and result card with template literals and inserts them with `innerHTML`. **A redesign of the table rows, the stock page and the trade panel must be done in these strings**, not in the `.html` files. Search for the container ID to find the template.

### 3.1 IDs (must exist with exactly this name, on the page shown)

| Page                  | Required static IDs (in the `.html`)                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **all app pages**     | `#app` (shell is injected into it), `#toast-region`                                                                                                          |
| `login.html`          | `form#login`, `#error` — first `<button>` inside the form is the submit button                                                                               |
| `register.html`       | `form#register`, `#error` — first `<button>` inside the form is the submit button. Inputs named exactly: `username`, `email`, `password`, `confirm_password` |
| `index.html`          | `#market-status-detail`, `#stats`, `#stock-search`, `#market-filter` (a `<select>` with values `all` / `watchlist`), `#market-table` (a `<tbody>`)           |
| `watchlist.html`      | `#watchlist-table`                                                                                                                                           |
| `portfolio.html`      | `#stats`, `#portfolio-table`                                                                                                                                 |
| `orders.html`         | `#orders-table`, `#trades-table`                                                                                                                             |
| `profile.html`        | `#profile-content`                                                                                                                                           |
| `stock.html`          | `#stock-content`                                                                                                                                             |
| `developer.html`      | `#developer-content`, `#developer-stats`, `#user-search`, `#users-table`                                                                                     |
| `developer-user.html` | `#developer-user-content`                                                                                                                                    |

| Created **by JS templates** (must be in the template string in `app.js`)       | Used for                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------- |
| `#price-chart` (a `<canvas>`), `#chart-empty`                                  | Stock price chart and its empty state           |
| `#quantity`, `#trade-button`, `#trade-feedback`, `#trade-result`               | Trade panel                                     |
| `#estimate-price`, `#estimate-value`, `#estimate-brokerage`, `#estimate-total` | Live cost estimate rows                         |
| `#logout`, `#theme-toggle`                                                     | Buttons in the top bar (built in `renderShell`) |

`data-*` hooks: **`[data-side]`** on the Buy/Sell buttons (value `BUY` / `SELL`) and **`[data-watch]`** on the star buttons (value = stock id). Both are bound with `querySelectorAll`, so any element can carry them.

### 3.2 Tables: **critical rule about `<tbody>`**

`#market-table`, `#watchlist-table`, `#portfolio-table`, `#orders-table`, `#trades-table` are **`<tbody>`** elements and the JS writes `<tr>` rows into them (empty/error states are `<tr><td colspan="N">…`). The `colspan` values are hard-coded in the row templates (full list below). **If a design changes the number of columns, update the `colspan` in the matching empty/error template too.**

#### Every hard-coded `colspan` (complete list, verified against `app.js`)

If a design changes a table's column count, update **that table's empty/error template** too:

| Table                                           | `colspan` | Built in                                                         |
| ----------------------------------------------- | --------- | ---------------------------------------------------------------- |
| Market list                                     | 5         | `loadMarket()`                                                   |
| Watchlist                                       | 5         | `loadWatchlist()`                                                |
| Portfolio positions                             | 7         | `loadPortfolio()`                                                |
| Orders                                          | 6         | `loadOrders()`                                                   |
| Trades                                          | 7         | `loadOrders()`                                                   |
| **Profile** → holdings                          | 6         | `loadProfile()` (the profile page builds its own holdings table) |
| **Profile** → recent activity                   | 6         | `loadProfile()`                                                  |
| **Developer** → users                           | 7         | `loadDeveloper()`                                                |
| **Developer user** → holdings / trades / orders | 5 / 9 / 6 | `loadDeveloperUser()`                                            |

> ⚠️ **Trap: `loadDeveloperUser()` is defined TWICE in `app.js`** (around line 464 and again around line 481).
> JavaScript silently uses the **last** definition, so the first is a stale draft that never runs.
> **Edit the second one only**, and delete the first (dead) copy in Phase 8 after confirming the page still works.
> This is the only duplicated function name in the file.

### 3.3 The shell (top bar + mobile bottom nav) is JavaScript-built

`renderShell()` in `app.js` **injects** the `<header class="topbar">` at the start of `#app` and the `<nav class="mobile-nav">` at the end. It also injects the "Developer Account · Trading Disabled" notice for admins. **Restyle these by editing the template strings in `renderShell()`**, not by putting a nav in the HTML files (that would create a duplicate). The theme button `#theme-toggle` and `#logout` must remain in that template; their click handlers are attached right after.

The active nav item is marked with class `active`, driven by `document.body.dataset.page`. Keep `data-page="…"` on each `<body>` (values in §0).

### 3.3.1 Tone classes

JS applies `positive`, `negative`, `neutral` to numbers (`tone()`), and `badge buy` / `badge sell` to side badges. Keep these class names, and define their colours in the new CSS from `DESIGN.md`.

---

## 4. Phase plan

Do **one phase at a time**. After each, stop and report. Each phase ends with a **verify** list.

### Phase 0 — Read and inspect (no changes)

1. Read this file, `DESIGN.md`, `frontend/js/api.js`, `frontend/js/app.js`, `frontend/js/theme.js`, `frontend/css/style.css` (skim), and everything in `design/`.
2. Produce a written **mapping table**: for each Stitch screen → the live `.html` file, the container IDs it maps to, which parts are static HTML vs `app.js` templates, and any design element with **no data source** (see §8).
3. List anything in the design that conflicts with this file (a missing required element, a different column count, an element that needs new API data).
4. **Stop.** Show the table and the list. Do not write code yet.

### Phase 1 — Design tokens and base CSS

1. Create `frontend/css/tokens.css` from `DESIGN.md`: light values on `:root`, dark values on `:root[data-theme="dark"]`. Map to the **existing variable names first** so nothing breaks: `--bg, --surface, --surface-soft, --border, --text, --muted, --primary, --primary-dark, --positive, --negative, --warning, --shadow`. Add the new ones the design needs: **`--reference`** (light `#6E7F86`, dark `#7C8E93`; **required**, the Phase 5 chart code reads it and silently falls back to `--muted` if it is missing), `--on-primary`, and `--chart-1..5`.
2. **Add `--on-primary`** and use it for text on filled teal/red buttons and badges. It is **white in light theme and dark `#101719` in dark theme** (white on the dark-theme teal/red fails contrast).
3. Build `frontend/css/style.css` (or split into `base.css`, `components.css`, `pages.css`) using **only** those variables. **No hard-coded colours** in components.
4. Load order in every `<head>`: `js/theme.js` first (prevents a flash of the wrong theme), then `css/tokens.css`, then `css/style.css`.
5. Fonts: the design uses **Inter**. The app currently has **no external fonts**. Either self-host Inter from `frontend/assets/fonts/` (preferred, works offline for demos) or include one Google Fonts `<link>`. Add `font-variant-numeric: tabular-nums` to all price/number elements. Provide a `system-ui` fallback.
6. Add `@media (prefers-reduced-motion: reduce)` to disable transforms/animations (§7).

**Verify:** open any page → correct colours in light and dark, toggle works, no flash of wrong theme on reload, text on teal buttons readable in **both** themes.

### Phase 2 — Auth pages (Register, Login)

1. Replace the markup in `register.html` and `login.html` with the Stitch design, keeping: `form#register` / `form#login`, `#error`, input `name`s (`username`, `email`, `password`, `confirm_password`), and the submit `<button>` as the first button in the form.
2. **Read `auth.js` before editing.** It resets the button text to `"Start with ₹1,00,000"` (register) or `"Sign in"` (login) after a failed request. If the new design uses different button text (e.g. "Open your desk"), **update those two strings in `auth.js` to match**, otherwise the label reverts to the old text after an error.
3. Keep client validation: passwords must match, minimum 6 characters. Show messages in `#error`.
4. Implement the motion (§7.1) in a **new** file `js/auth-motion.js` (or CSS only). Do not put motion logic into `auth.js`.
5. `auth.js` does not use `#toast-region`, so it is not required on these two pages.

**Verify:** register a new user → lands on Market; log in with a wrong password → the friendly error appears and the button re-enables; keyboard-only submit works; both themes; phone width (390px) and desktop (1440px).

### Phase 3 — Shell and navigation

1. Restyle `renderShell()`'s template strings to match the design: desktop top bar; **mobile bottom tab bar with 5 tabs** (Market, Watchlist, Portfolio, Orders, Profile); the admin-only "Developer" link; the read-only notice.
2. Replace the current Unicode glyph icons (`⌂ ☆ ◫ ≡ ◐ ☀`) with the design's inline SVG icons. `updateThemeToggle()` currently sets `toggle.textContent` — change it to swap an SVG (or a class), not text, and keep `title` updates.
3. Keep `#logout` and `#theme-toggle`. Keep the `active` class logic.
4. Mobile: respect safe-area insets (`env(safe-area-inset-bottom)`), and add `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` to every page.

**Verify:** every page shows the correct active tab; Developer link appears only for the developer account; logout returns to login; theme toggle icon changes.

### Phase 4 — Market, Watchlist

1. Update the static HTML for `index.html` and `watchlist.html` (intro, stats container, toolbar, table header).
2. Update `stockRow()` and the watchlist row template in `app.js` to the new row design. Keep `data-watch` on the star and the link to `stock.html?id=<id>`.
3. **Responsive tables:** on phones, convert each row to a stacked card **with CSS only** (see §6.3) — do not maintain a second copy of the markup.
4. Update `renderStats()` for the new stat-card design (label + value + delta chip). Keep the container `#stats`.
5. Keep the search (`#stock-search`) and filter (`#market-filter`) working; keep the empty-state messages.

**Verify:** search filters; the watchlist star adds/removes and shows a toast; empty states render; at 390px the rows are cards and nothing scrolls sideways.

### Phase 5 — Stock detail and trading (highest risk)

1. Redesign the templates inside `loadStock()` (stock heading, chart card, trade panel) and `bindTrade()`'s result card. Keep every ID in §3.1's "created by JS" table.
2. **Chart colours must come from CSS variables, not hard-coded hex.** Today `drawChart()` hard-codes `#0b756d` and `#8a98a5`, so the lines do not change in dark mode. Read `--primary` (MockFolio line) and `--reference` (dashed grey reference line) with `getComputedStyle`, and re-apply them inside `applyChartTheme()` for **both datasets** (`borderColor` and the fill `backgroundColor`), so the theme toggle recolours the lines too. Give the reference dataset `borderDash: [6, 4]`.
3. Pin Chart.js to an exact version instead of the unpinned `https://cdn.jsdelivr.net/npm/chart.js` (use e.g. `chart.js@4.4.x/dist/chart.umd.min.js`; check the version the app currently resolves before pinning, and confirm the chart still renders).
4. Keep: quantity validation, the live estimate, brokerage rounding as the server returns it, `client_order_key: crypto.randomUUID()`, button disable/`finally` re-enable, and the developer-account "trading disabled" variant.
5. The result card must show: `fill_price`, `total_cost`, `brokerage`, `price_before`, `price_after`, `price_impact`, `deviation_after_trade`.
6. After a successful trade the current code pushes a point onto the chart and calls `priceChart.update()`. Keep that behaviour.

**Verify (do all, in the browser):** buy 10 → success card, chart gains a point, cash balance changes on Market; sell more than you own → the friendly "You do not own enough shares to sell." error; double-click Buy → **exactly one** order (check Orders); toggle theme with the chart open → both lines recolour; a stock with no history shows the empty state.

### Phase 6 — Portfolio, Orders, Profile

1. Update `portfolio.html`, `orders.html`, `profile.html` and the templates in `loadPortfolio()`, `loadOrders()`, `loadProfile()`.
2. Note the **Profile page builds its own holdings and recent-activity tables** inside `loadProfile()` (it does not reuse the Portfolio templates), so restyle those templates separately.
   2b. Add the **allocation donut** (§5) and the other charts the design specifies that **have data** (see §8).
3. Keep column counts consistent with the `colspan` values (or update them).
4. Keep the empty states ("Your portfolio is empty…", "No activity yet.").

**Verify:** a fresh user sees empty states; after one buy the donut shows Cash + the holding; P&L shows sign **and** colour; Orders/Trades tables fill.

### Phase 7 — Developer pages

1. Update `developer.html`, `developer-user.html` and their templates. Keep `#user-search`, `#users-table`, `#developer-stats`. **Edit only the second `loadDeveloperUser()`** (see the trap in §3.2).
2. The destructive actions (**Reset market**, **Reset account**) must show a **confirm dialog** before calling `resetMarket()` / `resetUser(id)`. Use a real `<dialog>` element or an accessible modal; do not use `window.confirm` if the design specifies a styled dialog.
3. These pages must remain admin-only. The API enforces it (403); the UI must show the friendly permission error, not a blank page.

**Verify:** log in as the developer account (from `.env`) → Developer link visible, pages load; a normal user opening `developer.html` sees the permission message.

### Phase 8 — Motion, polish, cleanup

1. Implement in-app motion (§7.2). All motion respects `prefers-reduced-motion`.
2. Remove dead CSS and unused classes from the old stylesheet **only after** confirming no template still uses them (grep first).
3. Lighthouse / manual pass (§9). Fix contrast and focus issues.
4. Write `frontend/README.md` (short): how to serve, folder layout, how tokens map to `DESIGN.md`, how to add a page.

**Verify:** run through §10 end to end.

---

## 5. Charts: implementation notes (Chart.js only)

Chart.js is already used; **do not add another chart library**. Load it (pinned) only on pages that draw charts. Every chart:

- reads colours from CSS variables via `getComputedStyle(document.documentElement)`;
- **re-themes on the `mockfolio-theme-change` window event** (fired by `theme.js`) — recolour and `chart.update("none")`;
- has a one-line caption beneath it and a text alternative (a visually hidden table or `aria-label` summarising the values);
- destroys/updates its old instance before redrawing (`chart.destroy()`) to avoid canvas-reuse errors.

| Chart                    | Chart.js type                                       | Data source (existing endpoints only)                           |
| ------------------------ | --------------------------------------------------- | --------------------------------------------------------------- |
| Price story (stock page) | `line`, 2 datasets, area fill on the MockFolio line | `history(id)` (reverse it: API is newest-first)                 |
| Portfolio allocation     | `doughnut` (`cutout: "68%"`)                        | `portfolio()` `current_value` + `summary().cash_balance`        |
| Invested vs current      | `bar`                                               | sums of `invested_value` and `current_value` from `portfolio()` |
| P&L by holding           | `bar` with `indexAxis: "y"`                         | `profit_loss` per holding; green ≥ 0, red < 0                   |
| Buys vs sells count      | `bar`                                               | count `side` in `trades()`                                      |
| Dev: top users           | `bar` (`indexAxis:"y"`)                             | `adminUsers()` sorted by `portfolio_value + cash_balance`       |

**Donut rules (from the design system):** at most **5 slices** = top 3–4 holdings + Cash + one grouped "Other"; **2–3px gap** between slices (`borderWidth` with the card colour as `borderColor`); a **legend with name, % and ₹ value**; click/tap a slice highlights it and its legend row; the centre shows total account value. Slice colours come from `--chart-1 … --chart-5` (defined in `tokens.css`, light and dark). Colour alone must never carry meaning.

---

## 6. Responsive and theming rules

### 6.1 One codebase, two layouts

There is **one** HTML page per screen. Phone vs desktop is done with **CSS media queries**, not separate files. The Stitch "mobile" and "web" screens are the **two targets of one responsive page**. Breakpoints: `< 768px` phone, `768–1100px` tablet, `> 1100px` desktop, content max-width `1200px`.

### 6.2 Dark mode

Dark mode is **not** separate HTML. `theme.js` sets `document.documentElement.dataset.theme = "light" | "dark"`; the dark palette lives in `:root[data-theme="dark"]` in `tokens.css`. If Stitch only exported light screens, generate dark by variable swap. If Stitch exported dark HTML, **extract its colours into the dark token block** and discard the duplicate markup.
Also honour the OS setting on first visit: if there is no saved theme, use `prefers-color-scheme`. (`theme.js` currently defaults to light; extend it, keeping the same key `mockfolio-theme` and the same event.)

### 6.3 Tables become cards on phones (CSS only, tested)

Keep semantic `<table>` markup. Convert rows to stacked cards at `< 768px` with CSS. **You must also override three rules in the current stylesheet or the page will still scroll sideways**: `table { min-width: 720px }`, `td { white-space: nowrap }`, and `.table-wrap { overflow: auto }`. (This was tested against the real Market page at 390 px: a naive `display: block` version left the page 739 px wide; the version below keeps it at 390 px with each row a card.)

```css
@media (max-width: 767px) {
  .table-wrap {
    overflow: visible;
    background: transparent;
    border: 0;
    box-shadow: none;
  }
  table {
    min-width: 0;
    width: 100%;
    display: block;
  } /* overrides min-width: 720px */
  thead {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  } /* keep for screen readers */
  tbody,
  tr,
  td {
    display: block;
  }
  tr {
    border: 1px solid var(--border);
    border-radius: 16px;
    margin-bottom: 12px;
    padding: 8px;
    background: var(--surface);
  }
  td {
    white-space: normal; /* overrides nowrap */
    border-bottom: 0;
    padding: 6px 4px;
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  td[data-label]::before {
    content: attr(data-label);
    color: var(--muted);
    font-weight: 600;
    flex: none;
  }
}
```

**Required companion change:** the current row templates in `app.js` have **no** `data-label` attributes (verified: 0 of 75 cells on the Market page). Add `data-label="Column name"` to every `<td>` in every row template (`stockRow()`, the watchlist, portfolio, orders, trades, profile and developer templates), matching that table's header text. Empty-state rows (`colspan`) should not get a label. This gives stacked cards without maintaining a second copy of the markup.

---

## 7. Motion

Honour `prefers-reduced-motion: reduce` **everywhere**: no transforms, no count-ups, no looping animation — use instant state changes or simple opacity fades. Prefer CSS; use JS only where CSS cannot do it. Durations: UI 150–300 ms; chart/hero draws ≤ 900 ms. Easing: ease-out. Do not animate `width/height/top/left`; use `transform` and `opacity`. No animation library is needed.

### 7.1 Register / Login (richest motion)

- **Hero:** an inline **SVG** with two paths (solid teal line, dashed grey line). Draw the teal path with `stroke-dasharray`/`stroke-dashoffset`; loop slowly; a small circle travels along it (`offset-path` or SMIL/`getPointAtLength`). Keep it low contrast. Pause the loop when the tab is hidden (`document.visibilityState`).
- **Headline count-up:** `₹0 → ₹1,00,000` over ~900 ms with `requestAnimationFrame`, formatted with `toLocaleString("en-IN")`. Under reduced motion, show the final number immediately.
- **Form stagger:** fields fade + slide up 8 px, 70 ms apart (CSS `animation-delay` via a `--i` index variable).
- **Field feedback:** border colour transition to `--primary` on focus; on validation error a brief horizontal shake (`transform` only) and the message fades in.
- **Password strength bar:** thin bar under the password field; fills and changes tone as you type. Score with simple rules (length ≥ 6, ≥ 10, mixed case, digit, symbol). This is **cosmetic only** — the real rule stays "min 6 characters".
- **Submit:** button shows a spinner while the request runs; do not delay navigation on success beyond ~300 ms.

### 7.2 Inside the app

| Effect             | How                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Page fade-in       | 200 ms opacity + 8 px translateY on `main.page`                                                                                                  |
| Stagger list rows  | CSS `animation-delay`, first ~10 rows only                                                                                                       |
| Number tween       | small `tween(el, from, to, 500ms)` helper using `requestAnimationFrame` for account value, P&L, prices; never tween on first paint with skeleton |
| Price-change flash | add a class that sets a soft tinted background for ~600 ms then removes it (green if up, red if down)                                            |
| Card hover         | `translateY(-2px)` + border colour, **desktop `(hover:hover)` only**; `scale(.98)` on `:active` for touch                                        |
| Charts             | Chart.js `animation: { duration: 700 }`; donut `animateRotate: true`; disable under reduced motion                                               |
| Trade success      | SVG check drawn with `stroke-dashoffset`, result card slide-in                                                                                   |
| Theme switch       | `transition: background-color .25s, color .25s, border-color .25s` on `body`, cards, inputs                                                      |
| Skeletons          | replace the text "Loading…" spinner rows (`loading()` helper) with shape-matched skeletons; slow soft shimmer, not a strobe                      |
| Toasts             | slide+fade in; thin progress line while visible (existing 3.6 s timeout stays)                                                                   |

---

## 8. Design elements with NO data source — how to handle each

The design was written ahead of the API. **Do not change the backend.** For each item below, do exactly what the table says and list it in your Phase 0 report.

| Design element                                           | Problem                                                                                                                                | Do this                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sector-mix chart**                                     | `/portfolio` returns no `sector`                                                                                                       | **Join on the client:** `stocks()` returns `sector` per `stock_id`; look it up by `stock_id`. Cheap, no backend change                                                                                                                       |
| **Sparklines** on Market/Watchlist rows                  | No per-stock history in list endpoints; calling `history(id)` for all 15 stocks on load is 15 extra requests                           | **Do not fetch for every row on page load.** Either omit sparklines on Market/Watchlist, or lazily fetch `history(id)` only for rows scrolled into view (`IntersectionObserver`) with a small in-memory cache. Default: **omit** and note it |
| **1H / 1D / 1W / All range selector** on the price chart | History rows are only written when a trade or decay runs, so there are few points, at irregular times; time ranges will often be empty | **Drop the time-range selector.** Show "Recent activity" (last up to 100 points). Mention this in the report                                                                                                                                 |
| **Account-value-over-time chart** (Profile)              | No history of account value exists                                                                                                     | **Omit.** Do not fake data                                                                                                                                                                                                                   |
| **Deviation meter**, price-impact bar, delta chips       | Derivable                                                                                                                              | Compute client-side from `deviation`, `deviation_percentage`, `price_impact`                                                                                                                                                                 |
| **Password strength meter**                              | Cosmetic                                                                                                                               | Client-side only (§7.1)                                                                                                                                                                                                                      |
| **Onboarding tour**                                      | No backend needed                                                                                                                      | Optional; store "seen" in `localStorage["mockfolio-onboarded"]`; skip if time-boxed                                                                                                                                                          |
| **"Reset anytime" reassurance text**                     | Only admins can reset accounts                                                                                                         | Reword to something true ("Virtual money only", "Prices react to trades") or drop it                                                                                                                                                         |
| **Real-time / auto-refresh prices**                      | No live feed                                                                                                                           | Prices refresh on load and after actions only. Do not add polling or WebSockets                                                                                                                                                              |

**Never fabricate numbers** to make a chart look full. An honest empty state ("No price history yet. Your first trade will create a point.") is correct.

---

## 9. Accessibility and quality bar

- Contrast **≥ 4.5:1** for text, ≥ 3:1 for large numbers and chart lines, in **both** themes. Text on filled teal/red uses `--on-primary`.
- Visible **focus ring** (2 px, `--primary`) on every interactive element; logical tab order; no `outline: none` without a replacement.
- Never colour alone: pair gain/loss colour with `+`/`−` or an arrow (the existing `signed()` helper already adds the sign).
- Semantic HTML: `<nav>`, `<main>`, `<table>` with `<th scope>`, `<button>` for actions, `<label for>` on inputs, `aria-live="polite"` on `#toast-region` and `#error`, `aria-busy` on containers while loading.
- Touch targets ≥ 44 × 44 px; safe-area insets respected.
- Images/SVG icons: decorative ones `aria-hidden="true"`; meaningful ones have a label.
- Page still fast: no image over 200 KB, no unused libraries, Chart.js only on pages that draw charts.

---

## 10. Final acceptance checklist

Run these against a real running backend + database (see `MOCKFOLIO_SETUP_GUIDE.md`). Report each as ✅ / ❌ / "could not test".

**Functional (must all pass)**

- [ ] Register → redirected to Market. Login with wrong password → friendly error, button re-enabled.
- [ ] Market lists the seeded stocks; search and All/Watchlist filter work; star adds/removes with a toast.
- [ ] Stock page: chart renders with two lines; **buy** works; **sell more than owned** shows the friendly error; **double-click Buy creates one order**.
- [ ] Portfolio, Orders, Profile show correct numbers and empty states for a brand-new user.
- [ ] Developer account: Developer pages work and reset actions ask for confirmation; a normal user is refused with the friendly message.
- [ ] Logout returns to login and clears the token; a hard refresh on any page while logged out redirects to login.
- [ ] Backend tests still pass: `pytest` (you did not touch the backend, so this must be unchanged).

**Design**

- [ ] Every page correct in **light and dark**, at **390 px** and **1440 px**. No sideways scrolling on phone.
- [ ] Theme toggle recolours **everything including charts** live; no flash of wrong theme on reload.
- [ ] Only the design system's colours used; no hard-coded hex outside `tokens.css` (grep to prove it: `grep -rn "#[0-9a-fA-F]\{3,6\}" frontend/css frontend/js` should only match `tokens.css` and data URIs).
- [ ] Reduced-motion setting disables animations (test by enabling it in the OS or DevTools).
- [ ] Keyboard-only run through login → buy a stock works, with visible focus.

**Hygiene**

- [ ] No console errors on any page (open DevTools on all 10).
- [ ] No leftover references to removed classes/IDs (grep for every ID in §3.1).
- [ ] `frontend/README.md` written; `design/` left untouched.
- [ ] Changes committed in small commits, one per phase, on a **new branch** (e.g. `frontend-redesign`), not directly on `main`.

---

## 11. If something in the design conflicts with this file

The **contract in §2 and §3 wins over the design**. If the design omits an element the JS needs, add the element back in the design's style. If the design needs data the API lacks, follow §8. If you are unsure, **stop and ask** rather than guessing. Never edit the backend to fit a screen.
