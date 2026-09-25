# MockFolio frontend

Plain HTML + CSS + vanilla JS + Chart.js. No build step, no framework, no bundler.

## Running it

The backend must already be running at `http://127.0.0.1:8000` (see the repo's
setup guide). Serve this folder as static files, **on port 5500 exactly** —
the backend's CORS only allows `http://127.0.0.1:5500` / `http://localhost:5500`:

```
python -m http.server 5500 -d frontend
```

Then open `http://127.0.0.1:5500/login.html` (or `register.html`).

## Folder layout

```
frontend/
├── *.html                 10 real pages + dashboard.html (redirects to index.html)
├── css/
│   ├── tokens.css         design tokens as CSS variables — light on :root,
│   │                      dark on :root[data-theme="dark"]. Load before style.css.
│   └── style.css          everything else. No hard-coded colours — every
│                          colour is one of the variables tokens.css defines.
├── js/
│   ├── api.js             the only file that talks to the backend. Don't replace it.
│   ├── app.js             all page logic: the shell (top bar + mobile nav),
│   │                      every page's load*()/render*() functions, the
│   │                      Chart.js wrappers, and the shared icon set.
│   ├── auth.js            login/register form submission
│   ├── auth-motion.js     decorative motion for the auth pages only (password
│   │                      toggles, strength meter, count-up, hero chart)
│   ├── theme.js            theme switching; sets documentElement[data-theme]
│   │                      before first paint to avoid a flash
│   └── dashboard.js, portfolio.js, stock.js   empty stubs, left as-is
└── assets/fonts/           self-hosted Inter (latin + latin-ext, for ₹)
```

## Design tokens (`css/tokens.css`)

Maps 1:1 to `../DESIGN.md`'s `colors` block. The variable names are the
*existing* app's names, not DESIGN.md's — e.g. DESIGN.md's `neutral` is this
app's `--bg`, `on-surface` is `--text`, `on-surface-muted` is `--muted`.
Everything else keeps DESIGN.md's own name (`--primary`, `--positive`, …).

Two tokens exist only in the app, not DESIGN.md's `colors` block:
- `--reference` — the dashed grey reference-price line's colour, used on the
  stock chart and the auth pages' hero illustration.
- `--on-primary` — text colour on filled teal/red buttons and badges. It's
  white in light mode; in dark mode the teal/red fills are *light*, so it
  flips to the dark background colour there (`#101719`) — check `tokens.css`
  before assuming white always works on a filled colour.
- `--chart-1` … `--chart-5` — the donut/multi-series palette from
  DESIGN.md's "Donut and multi-slice charts" note.

Dark mode is a tuned palette, not an inversion — see the values already in
`tokens.css` if you need to add a new token; don't invert the light one.

## Adding a page

1. Copy the `<head>` block from any existing app page (not `login.html` /
   `register.html`, which don't have the shell): `theme.js` first, then
   `tokens.css`, then `style.css`, in that order — `theme.js` has to run
   before first paint to avoid a flash of the wrong theme.
2. `<body data-page="yourpage">` — this is how `renderShell()` in `app.js`
   knows which nav item to mark `active`, both in the desktop top bar and
   the mobile bottom tabs.
3. Wrap content in `<div id="app"><main class="page">…</main></div>`, with
   `<div id="toast-region" class="toast-region"></div>` right after it.
4. Give any list/table a stable container `id` and, if it's a `<tbody>`,
   `data-cols="N"` matching its real column count — the shared `loading()`
   helper uses that to show a shape-matched skeleton instead of a spinner.
5. Add the page's `load*()` function to `app.js` and call it from `start()`'s
   `if (page === "yourpage") await loadYourPage();` chain.
6. If the page draws a chart, add the pinned Chart.js script tag
   (`chart.js@4.5.1/dist/chart.umd.min.js` — match the version already used
   elsewhere) and read colours from `getComputedStyle` rather than
   hard-coding them, the same way `applyChartTheme()` does for the stock
   chart. A page with no chart shouldn't load Chart.js at all.
7. Table rows: build them as `<tr>`/`<td data-label="Column name">…` (not
   `<div>` grids) so the existing `@media (max-width: 767px)` rule can turn
   them into stacked cards on phones with no separate markup.
8. Escape any API string before it goes into `innerHTML` — use the
   `escapeHTML()` helper already in `app.js`. Format money with
   `api.formatINR` (aliased to `money` in `app.js`), never re-implement it.

## Things that are easy to get wrong here

- **Duplicate function names** silently use the *last* definition — there
  was a `loadDeveloperUser()` defined twice for a while; only the second one
  ever ran. If a page's behaviour doesn't match the code you're reading,
  grep for a second `function` with the same name before assuming a bug
  elsewhere.
- **`renderStats()`** takes an array of `{ label, value, valueTone?,
  caption?, chip?, chipTone? }` objects, not a raw API response — build the
  array with `summaryStats(summary, holdingsCount)` for the usual 4-stat set,
  or your own array for something else.
- **`bindWatchButtons()`** re-renders the whole page (`loadMarket()` /
  `loadWatchlist()`) after a toggle on those two pages, but just flips the
  clicked button's own state everywhere else (e.g. the stock detail page) —
  there's no list to re-render there.
