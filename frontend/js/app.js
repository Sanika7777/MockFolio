(() => {
  const api = window.MockfolioApi;
  const page = document.body.dataset.page;
  if (!localStorage.getItem("token")) {
    location.href = "login.html";
    return;
  }

  let stocks = [];
  let watchlist = [];
  let stockChart;
  let stockPoll;
  let refreshStock;
  let currentUser;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const money = api.formatINR;
  const reducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tone = (value) =>
    Number(value || 0) > 0
      ? "positive"
      : Number(value || 0) < 0
        ? "negative"
        : "neutral";
  const signed = (value) =>
    `${Number(value || 0) >= 0 ? "+" : ""}${money(value)}`;
  const percent = (value) =>
    `${Number(value || 0) >= 0 ? "+" : ""}${Number(value || 0).toFixed(2)}%`;
  const escapeHTML = (value) =>
    String(value ?? "").replace(
      /[&<>\"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        })[char],
    );

  function toast(message, type = "info") {
    const element = document.createElement("div");
    element.className = `toast ${type}`;
    element.textContent = message;
    $("#toast-region")?.append(element);
    setTimeout(() => element.remove(), 3600);
  }

  // Shape-matched skeleton rows for <tbody> loading targets (the tbody
  // declares its real column count via data-cols); anything else falls
  // back to the spinner. The shimmer is a CSS animation, so it's already
  // neutralised by the global prefers-reduced-motion rule.
  function loading(selector, message) {
    const el = $(selector);
    if (!el) return;
    if (el.tagName === "TBODY") {
      const cols = Number(el.dataset.cols) || 5;
      el.innerHTML = Array.from(
        { length: 4 },
        () =>
          `<tr class="skeleton-row">${"<td><span class=\"skeleton-bar\"></span></td>".repeat(cols)}</tr>`,
      ).join("");
      return;
    }
    el.innerHTML = `<div class="loading"><span class="spinner"></span>${message}</div>`;
  }

  // ~500ms eased count from `from` to `to`, formatted with `format`. Used
  // only for a value that changes in place after an action (e.g. a trade),
  // never for a value's first appearance on the page.
  function tweenNumber(el, from, to, format, duration = 500) {
    if (!el) return;
    if (reducedMotion() || from === to) {
      el.textContent = format(to);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = format(from + (to - from) * eased);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Fades in the first ~10 rows of a freshly-rendered table, staggered.
  // Skips empty/error placeholder rows and does nothing under reduced motion.
  function staggerRows(selector) {
    if (reducedMotion()) return;
    $$(`${selector} tr`)
      .slice(0, 10)
      .forEach((row, i) => {
        if (row.querySelector(".empty-state, .error-state")) return;
        row.style.setProperty("--i", i);
        row.classList.add("row-in");
      });
  }

  const svgIcon = (inner, cls) =>
    `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICONS = {
    market: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    watchlist:
      '<path d="M12 3.3l2.7 5.6 6.1.6-4.6 4.1 1.3 6.1L12 16.6l-5.5 3.1 1.3-6.1-4.6-4.1 6.1-.6L12 3.3Z"/>',
    portfolio: '<circle cx="12" cy="12" r="8.2"/><path d="M12 3.8V12l6.3 3.4"/>',
    orders:
      '<path d="M6.5 3h11v18l-2.75-1.8L12 21l-2.75-1.8L6.5 21V3Z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
    developer: '<path d="M7 8l-3.5 4L7 16"/><path d="M17 8l3.5 4L17 16"/><path d="M14 6l-4 12"/>',
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
    logout:
      '<path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/><path d="M15 16l4-4-4-4"/><path d="M19 12H9"/>',
    warning:
      '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    candles: '<path d="M7 4v3M7 17v3M17 3v4M17 15v6"/><rect x="5" y="7" width="4" height="10" rx="1"/><rect x="15" y="7" width="4" height="8" rx="1"/>',
    lines: '<path d="M3 17l5-5 4 3 9-8"/><path d="M3 20l6-4 4 2 8-6" opacity=".55"/>',
    plusCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>',
    minusCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/>',
    check: '<path class="draw-in" pathLength="1" d="M4.5 12.5 9 17l10.5-10.5"/>',
  };

  function renderShell(user) {
    const active = (name) => (page === name ? "active" : "");
    const avatarInitial = escapeHTML(
      (user.name || user.username || "U").trim().charAt(0).toUpperCase() || "U",
    );
    const developerLink = user.is_admin
      ? `<a class="${active("developer")}" href="developer.html">Developer</a>`
      : "";
    const header = `<header class="topbar"><a class="brand" href="index.html"><span class="brand-mark">M</span><span>mockfolio</span></a><nav class="desktop-nav"><a class="${active("market")}" href="index.html">Market</a><a class="${active("watchlist")}" href="watchlist.html">Watchlist</a><a class="${active("portfolio")}" href="portfolio.html">Portfolio</a><a class="${active("orders")}" href="orders.html">Orders</a>${developerLink}</nav><div class="top-actions"><button class="theme-toggle icon-button" id="theme-toggle" title="Switch theme" aria-label="Switch theme">${svgIcon(ICONS.sun, "icon-sun")}${svgIcon(ICONS.moon, "icon-moon")}</button><a class="nav-avatar" href="profile.html" title="Open profile" aria-label="Open profile">${avatarInitial}</a><button class="logout-button" id="logout">${svgIcon(ICONS.logout)}<span>Logout</span></button></div></header>`;
    const showNotice = user.is_admin && page !== "profile";
    const onDeveloperPage = page === "developer" || page === "developer-user";
    const noticeTag = showNotice && !onDeveloperPage ? "a" : "div";
    const noticeHref = showNotice && !onDeveloperPage ? ' href="developer.html"' : "";
    const notice = showNotice
      ? `<${noticeTag} class="read-only-notice"${noticeHref}>${svgIcon(ICONS.warning)}Developer account <span>Trading disabled</span></${noticeTag}>`
      : "";
    $("#app").insertAdjacentHTML("afterbegin", header + notice);

    const mobileTabs = [
      ["market", "index.html", ICONS.market, "Market"],
      ["watchlist", "watchlist.html", ICONS.watchlist, "Watchlist"],
      ["portfolio", "portfolio.html", ICONS.portfolio, "Portfolio"],
      ["orders", "orders.html", ICONS.orders, "Orders"],
      ["profile", "profile.html", null, "Profile"],
    ];
    if (user.is_admin)
      mobileTabs.push(["developer", "developer.html", ICONS.developer, "Developer"]);
    const activeIndex = mobileTabs.findIndex(([name]) => name === page);
    const tabsHTML = mobileTabs
      .map(
        ([name, href, icon, label]) =>
          `<a class="${active(name)}" href="${href}">${icon ? svgIcon(icon) : `<span class="tab-avatar">${avatarInitial}</span>`}<span>${label}</span></a>`,
      )
      .join("");
    const navClass = activeIndex >= 0 ? "mobile-nav" : "mobile-nav no-active";
    const navStyle =
      activeIndex >= 0
        ? ` style="--tab-count:${mobileTabs.length};--active-index:${activeIndex}"`
        : "";
    $("#app").insertAdjacentHTML(
      "beforeend",
      `<nav class="${navClass}"${navStyle}>${tabsHTML}</nav>`,
    );
    $("#logout").onclick = () => {
      localStorage.removeItem("token");
      localStorage.removeItem("mockfolio-user");
      sessionStorage.removeItem("mockfolio-session");
      location.href = "login.html";
    };
    $("#theme-toggle").onclick = () => window.MockfolioTheme.toggle();
    updateThemeToggle();
  }

  function updateThemeToggle() {
    const dark = window.MockfolioTheme.current() === "dark";
    const toggle = $("#theme-toggle");
    if (toggle) {
      toggle.title = dark ? "Switch to light mode" : "Switch to dark mode";
      toggle.setAttribute(
        "aria-label",
        dark ? "Switch to light mode" : "Switch to dark mode",
      );
    }
  }

  function renderStats(items) {
    if (!$("#stats")) return;
    $("#stats").innerHTML = items
      .map(
        ({ label, value, valueTone, caption, chip, chipTone }) =>
          `<div class="stat"><span class="stat-label">${label}</span><strong class="stat-value${valueTone ? ` ${valueTone}` : ""}">${value}</strong>${
            chip
              ? `<span class="stat-chip${chipTone ? ` ${chipTone}` : ""}">${chip}</span>`
              : caption
                ? `<span class="stat-caption">${caption}</span>`
                : ""
          }</div>`,
      )
      .join("");
  }

  // Shared 4-stat descriptor set for Market and Portfolio (§4/§6). holdingsCount
  // is optional; when omitted the holdings-value stat has no caption.
  function summaryStats(summary, holdingsCount) {
    const pnl = Number(summary.unrealised_pnl || 0);
    const startingCash = Number(summary.starting_cash) || 1;
    const pnlPercent = (pnl / startingCash) * 100;
    const arrow = pnl > 0 ? "▲" : pnl < 0 ? "▼" : "–";
    return [
      {
        label: "Total account value",
        value: money(summary.total_account_value),
        caption: `Initial ${money(summary.starting_cash)}`,
      },
      {
        label: "Available cash",
        value: money(summary.cash_balance),
        caption: "Virtual balance",
      },
      {
        label: "Holdings value",
        value: money(summary.holdings_value),
        caption:
          holdingsCount === undefined
            ? undefined
            : `${holdingsCount} open position${holdingsCount === 1 ? "" : "s"}`,
      },
      {
        label: "Total P&L",
        value: signed(pnl),
        valueTone: tone(pnl),
        chip: `${arrow} ${percent(pnlPercent)}`,
        chipTone: tone(pnl),
      },
    ];
  }

  function stockRow(stock, starred) {
    const deviation = Number(stock.deviation);
    const href = `stock.html?id=${stock.instrument_id}`;
    const arrow = deviation > 0 ? "▲" : deviation < 0 ? "▼" : "–";
    const actionLabel = currentUser?.is_admin ? "View" : "Trade";
    const sectorTag = stock.sector
      ? `<span class="sector-tag">${escapeHTML(stock.sector)}</span>`
      : "";
    return `<tr><td data-label="Stock"><a class="stock-name" href="${href}"><span class="stock-name-top"><strong>${escapeHTML(stock.symbol)}</strong>${sectorTag}</span><small>${escapeHTML(stock.company_name)}</small></a></td><td data-label="MockFolio price"><strong class="market-price">${money(stock.adjusted_price)}</strong><small>MockFolio price</small></td><td data-label="Reference price">${money(stock.raw_price)}</td><td data-label="Deviation"><div class="deviation-cell"><div class="deviation-text"><span class="deviation-chip ${tone(deviation)}">${arrow} ${signed(deviation)}</span><small class="${tone(deviation)}">${percent(stock.deviation_percentage)}</small></div></div></td><td data-label="Action"><div class="row-actions"><button class="table-action${starred ? " is-watched" : ""}" data-watch="${stock.instrument_id}" title="${starred ? "Remove from watchlist" : "Add to watchlist"}" aria-pressed="${starred}">${svgIcon(ICONS.watchlist)}</button><a class="trade-link" href="${href}">${actionLabel}</a></div></td></tr>`;
  }

  function bindWatchButtons() {
    $$("[data-watch]").forEach(
      (button) =>
        (button.onclick = async () => {
          const id = Number(button.dataset.watch);
          try {
            if (watchlist.some((item) => item.id === id)) {
              await api.removeWatchlist(id);
              watchlist = watchlist.filter((item) => item.id !== id);
              toast("Removed from watchlist");
            } else {
              await api.addWatchlist(id);
              watchlist.push(stocks.find((item) => item.id === id) || { id });
              toast("Added to watchlist", "success");
            }
            if (page === "watchlist") await loadWatchlist();
            else {
              // Any other page with a star button (e.g. the stock detail
              // page): just update this button, no list to re-render.
              const nowStarred = watchlist.some((item) => item.id === id);
              button.classList.toggle("is-watched", nowStarred);
              button.setAttribute("aria-pressed", String(nowStarred));
              button.title = nowStarred
                ? "Remove from watchlist"
                : "Add to watchlist";
            }
          } catch (error) {
            toast(error.message, "error");
          }
        }),
    );
  }

  const SCREENER_SORTS = {
    symbol: (s) => s.symbol,
    price: (s) => Number(s.adjusted_price),
    change: (s) => Number(s.day_change_percentage),
    deviation: (s) => Number(s.deviation_percentage),
    volume: (s) => Number(s.day_volume),
  };

  function dayRange(stock) {
    const low = Number(stock.day_low);
    const high = Number(stock.day_high);
    const at = high > low ? ((Number(stock.adjusted_price) - low) / (high - low)) * 100 : 50;
    return `<div class="day-range" title="Today's range ${money(low)} – ${money(high)}"><div class="day-range-track"><span style="left:${Math.min(100, Math.max(0, at)).toFixed(1)}%"></span></div><div class="day-range-ends"><small>${money(low)}</small><small>${money(high)}</small></div></div>`;
  }

  function screenerRow(stock, starred) {
    const href = `stock.html?id=${stock.instrument_id}`;
    const change = Number(stock.day_change_percentage);
    const actionLabel = currentUser?.is_admin ? "View" : "Trade";
    const sectorTag = stock.sector ? `<span class="sector-tag">${escapeHTML(stock.sector)}</span>` : "";
    return `<tr><td data-label="Stock"><a class="stock-name" href="${href}"><span class="stock-name-top"><strong>${escapeHTML(stock.symbol)}</strong>${sectorTag}</span><small>${escapeHTML(stock.company_name)}</small></a></td><td data-label="Price" class="num"><strong class="market-price">${money(stock.adjusted_price)}</strong></td><td data-label="Day change" class="num"><span class="change-pill ${tone(change)}">${change > 0 ? "▲" : change < 0 ? "▼" : "–"} ${percent(change)}</span></td><td data-label="Day range">${dayRange(stock)}</td><td data-label="Real price" class="num">${money(stock.raw_price)}</td><td data-label="Deviation" class="num"><span class="${tone(stock.deviation)}">${percent(stock.deviation_percentage)}</span></td><td data-label="Volume" class="num">${Number(stock.day_volume || 0).toLocaleString("en-IN")}</td><td data-label="Action"><div class="row-actions"><button class="table-action${starred ? " is-watched" : ""}" data-watch="${stock.instrument_id}" title="${starred ? "Remove from watchlist" : "Add to watchlist"}" aria-pressed="${starred}">${svgIcon(ICONS.watchlist)}</button><a class="trade-link" href="${href}">${actionLabel}</a></div></td></tr>`;
  }

  function moversCard(title, list, value) {
    return `<div class="panel mover-card"><span class="eyebrow">${title}</span><ol>${list
      .map(
        (s) => `<li><a href="stock.html?id=${s.instrument_id}"><strong>${escapeHTML(s.symbol)}</strong><span>${money(s.adjusted_price)}</span><em class="${tone(value(s))}">${percent(value(s))}</em></a></li>`,
      )
      .join("")}</ol></div>`;
  }

  function renderMovers() {
    const host = $("#movers");
    if (!host || !stocks.length) return;
    const by = (fn, dir) => [...stocks].sort((a, b) => dir * (fn(a) - fn(b))).slice(0, 3);
    const change = (s) => Number(s.day_change_percentage);
    const gap = (s) => Number(s.deviation_percentage);
    host.innerHTML =
      moversCard("TOP GAINERS TODAY", by(change, -1), change) +
      moversCard("TOP LOSERS TODAY", by(change, 1), change) +
      moversCard("FURTHEST FROM REAL PRICE", by((s) => Math.abs(gap(s)), -1), gap);
  }

  let marketPoll;
  async function loadMarket() {
    loading("#market-table", "Loading market...");
    try {
      const [stocksData, watchlistData, summary, holdings] = await Promise.all([
        api.stocks(),
        api.watchlist(),
        api.summary(),
        api.portfolio(),
      ]);
      stocks = stocksData;
      watchlist = watchlistData;
      let sortKey = "symbol";
      let sortDir = 1;
      let sector = "All";
      const sectors = ["All", ...new Set(stocks.map((s) => s.sector).filter(Boolean))].sort((a, b) =>
        a === "All" ? -1 : b === "All" ? 1 : a.localeCompare(b),
      );
      $("#sector-chips").innerHTML = sectors
        .map((name) => `<button type="button" class="chip${name === "All" ? " active" : ""}" data-sector="${escapeHTML(name)}" aria-pressed="${name === "All"}">${escapeHTML(name)}</button>`)
        .join("");

      const render = (animate) => {
        const query = $("#stock-search").value.trim().toLowerCase();
        const watchIds = new Set(watchlist.map((item) => item.id));
        const mode = $("#market-filter").value;
        const key = SCREENER_SORTS[sortKey];
        const filtered = stocks
          .filter(
            (stock) =>
              `${stock.symbol} ${stock.company_name}`.toLowerCase().includes(query) &&
              (sector === "All" || stock.sector === sector) &&
              (mode !== "watchlist" || watchIds.has(stock.instrument_id)),
          )
          .sort((a, b) => {
            const x = key(a);
            const y = key(b);
            return sortDir * (typeof x === "string" ? x.localeCompare(y) : x - y);
          });
        $("#market-table").innerHTML = filtered.length
          ? filtered.map((stock) => screenerRow(stock, watchIds.has(stock.instrument_id))).join("")
          : `<tr><td colspan="8"><div class="empty-state compact"><strong>${query ? "No stocks match your search." : mode === "watchlist" ? "No stocks in your watchlist." : "No stocks available."}</strong><span>${query ? "Try a different symbol or company name." : "Try another sector or filter."}</span></div></td></tr>`;
        $$("[data-sort]").forEach((th) =>
          th.setAttribute("aria-sort", th.dataset.sort === sortKey ? (sortDir > 0 ? "ascending" : "descending") : "none"),
        );
        $("#screener-count").textContent = `${filtered.length} of ${stocks.length}`;
        renderMovers();
        bindWatchButtons();
        if (animate) staggerRows("#market-table");
      };
      render(true);
      $("#market-status-detail").textContent = `${stocks.length} active stocks · updates every 10s`;
      $("#stock-search").oninput = () => render(false);
      $("#market-filter").onchange = () => render(false);
      $$("[data-sector]").forEach(
        (chip) =>
          (chip.onclick = () => {
            sector = chip.dataset.sector;
            $$("[data-sector]").forEach((c) => {
              c.classList.toggle("active", c === chip);
              c.setAttribute("aria-pressed", String(c === chip));
            });
            render(false);
          }),
      );
      $$("[data-sort] button").forEach(
        (button) =>
          (button.onclick = () => {
            const next = button.parentElement.dataset.sort;
            // Numbers start high-to-low, names A-Z; a second click flips it.
            sortDir = next === sortKey ? -sortDir : next === "symbol" ? 1 : -1;
            sortKey = next;
            render(false);
          }),
      );
      renderStats(summaryStats(summary, holdings.length));
      clearInterval(marketPoll);
      marketPoll = setInterval(async () => {
        if (document.hidden) return;
        try {
          stocks = await api.stocks();
          render(false);
        } catch {
          // keep the last good table
        }
      }, 10000);
    } catch (error) {
      $("#market-table").innerHTML = `<tr><td colspan="8"><div class="error-state">${escapeHTML(error.message)}</div></td></tr>`;
    }
  }

  function valueChartCard() {
    return `<div class="panel value-card"><div class="panel-heading"><div><span class="eyebrow">PERFORMANCE</span><h2>Portfolio value</h2></div><div class="value-card-figure"><strong id="value-now">₹0</strong><em id="value-change" class="neutral"></em></div></div><div class="value-chart" id="value-chart" role="img" aria-label="Portfolio value over time against your starting cash"></div><p class="chart-caption" id="value-caption">Cash plus holdings at the MockFolio price, replayed from your trades. Green above your starting cash, red below.</p></div>`;
  }

  async function renderValueChart(summary) {
    const host = $("#value-chart");
    if (!host || !window.MockfolioCharts) return;
    const start = Number(summary.starting_cash) || 0;
    const now = Number(summary.total_account_value) || 0;
    $("#value-now").textContent = money(now);
    const change = $("#value-change");
    change.className = tone(now - start);
    change.textContent = `${signed(now - start)} (${percent(start ? ((now - start) / start) * 100 : 0)}) since start`;
    try {
      const points = await api.portfolioHistory();
      if (!points.length) {
        host.innerHTML = `<div class="empty-state compact"><strong>No trades yet</strong><span>Your value chart starts with your first trade.</span></div>`;
        return;
      }
      window.MockfolioCharts.createValueChart(host, { baseline: start }).setData(points);
    } catch (error) {
      host.innerHTML = `<div class="error-state">${escapeHTML(error.message)}</div>`;
    }
  }

  async function loadPortfolio() {
    loading("#portfolio-table", "Loading portfolio...");
    try {
      const [summary, holdings] = await Promise.all([
        api.summary(),
        api.portfolio(),
      ]);
      renderStats(summaryStats(summary, holdings.length));
      const chartsHost = $("#portfolio-charts");
      if (chartsHost) {
        chartsHost.innerHTML = valueChartCard();
        renderValueChart(summary);
      }
      $("#portfolio-table").innerHTML = holdings.length
        ? holdings
            .map(
              (item) =>
                `<tr><td data-label="Stock"><a class="stock-name" href="stock.html?id=${item.instrument_id}"><strong>${escapeHTML(item.symbol)}</strong></a></td><td data-label="Quantity">${Number(item.quantity).toLocaleString("en-IN")}</td><td data-label="Average buy">${money(item.avg_price)}</td><td data-label="Current price">${money(item.adjusted_price)}</td><td data-label="Invested">${money(item.invested_value)}</td><td data-label="Current value">${money(item.market_value)}</td><td data-label="P&L" class="${tone(item.unrealised_pnl)}"><strong>${signed(item.unrealised_pnl)}</strong><small>${percent((Number(item.unrealised_pnl) / Number(item.invested_value || 1)) * 100)}</small></td></tr>`,
            )
            .join("")
        : `<tr><td colspan="7"><div class="empty-state"><strong>Your portfolio is empty</strong><span>Start paper trading to build your portfolio.</span><a class="primary-button" href="index.html">Browse stocks</a></div></td></tr>`;
      staggerRows("#portfolio-table");
    } catch (error) {
      $("#portfolio-table").innerHTML =
        `<tr><td colspan="7"><div class="error-state">${escapeHTML(error.message)}</div></td></tr>`;
    }
  }

  async function loadOrders() {
    loading("#orders-table", "Loading orders...");
    loading("#trades-table", "Loading trades...");
    try {
      const [orders, trades] = await Promise.all([api.orders(), api.trades()]);
      const statsHost = $("#orders-stats");
      if (statsHost) {
        if (!orders.length && !trades.length) {
          statsHost.innerHTML = "";
        } else {
          const buys = trades.filter((item) => item.side === "BUY").length;
          const sells = trades.length - buys;
          const buyPercent = trades.length ? (buys / trades.length) * 100 : 0;
          const brokerage = trades.reduce(
            (sum, item) => sum + Number(item.brokerage || 0),
            0,
          );
          statsHost.innerHTML = `<div class="stat"><span class="stat-label">Total orders</span><strong class="stat-value">${orders.length}</strong><span class="stat-caption">${trades.length} filled trade${trades.length === 1 ? "" : "s"}</span></div><div class="stat"><span class="stat-label">Brokerage paid</span><strong class="stat-value">${money(brokerage)}</strong><span class="stat-caption">Across all trades</span></div><div class="stat ratio-stat"><span class="stat-label">Buys vs sells</span><div class="ratio-bar"><span class="ratio-buy" style="width:${buyPercent}%"></span></div><div class="ratio-legend"><span class="positive">${buys} buys</span><span class="negative">${sells} sells</span></div></div>`;
        }
      }
      $("#orders-table").innerHTML = orders.length
        ? orders
            .map(
              (item) =>
                `<tr><td data-label="Date">${new Date(item.created_at).toLocaleString("en-IN")}</td><td data-label="Stock"><strong>${escapeHTML(item.symbol)}</strong></td><td data-label="Type"><span class="badge ${item.order_type.toLowerCase()}">${item.order_type}</span></td><td data-label="Quantity">${item.quantity}</td><td data-label="Limit price">${item.limit_price ? money(item.limit_price) : "—"}</td><td data-label="Status"><span class="badge filled">${item.status}</span></td></tr>`,
            )
            .join("")
        : `<tr><td colspan="6"><div class="empty-state"><strong>No orders yet</strong><span>Your completed orders will appear here.</span></div></td></tr>`;
      $("#trades-table").innerHTML = trades.length
        ? trades
            .map(
              (item) =>
                `<tr><td data-label="Date">${new Date(item.executed_at).toLocaleString("en-IN")}</td><td data-label="Stock"><strong>${escapeHTML(item.symbol)}</strong></td><td data-label="Side"><span class="badge ${item.side.toLowerCase()}">${item.side}</span></td><td data-label="Quantity">${item.quantity}</td><td data-label="Fill price">${money(item.exec_price)}</td><td data-label="Brokerage">${money(item.brokerage)}</td><td data-label="Price impact" class="${tone(item.price_impact)}">${signed(item.price_impact)}</td></tr>`,
            )
            .join("")
        : `<tr><td colspan="7"><div class="empty-state"><strong>No trades yet</strong><span>Execute a trade to see its price impact here.</span></div></td></tr>`;
      staggerRows("#orders-table");
      staggerRows("#trades-table");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function loadWatchlist() {
    loading("#watchlist-table", "Loading watchlist...");
    try {
      watchlist = await api.watchlist();
      stocks = watchlist;
      const statusDetail = $("#watchlist-status-detail");
      if (!watchlist.length) {
        $("#watchlist-table").innerHTML = `<tr><td colspan="5"><div class="empty-state"><strong>Your watchlist is empty</strong><span>Star a stock from the market to keep it close.</span><a class="primary-button" href="index.html">Explore market</a></div></td></tr>`;
        if (statusDetail) statusDetail.textContent = "Nothing tracked yet";
        return;
      }
      const chips = $$(".chip-group [data-chip]");
      const render = (animate) => {
        const query = ($("#watchlist-search")?.value || "").trim().toLowerCase();
        const mode = chips.find((chip) => chip.classList.contains("active"))?.dataset.chip || "all";
        const filtered = watchlist.filter((stock) => {
          const deviation = Number(stock.deviation);
          const matchesQuery = `${stock.symbol} ${stock.company_name}`
            .toLowerCase()
            .includes(query);
          const matchesMode =
            mode === "all" ||
            (mode === "gainers" && deviation > 0) ||
            (mode === "lagging" && deviation < 0);
          return matchesQuery && matchesMode;
        });
        $("#watchlist-table").innerHTML = filtered.length
          ? filtered.map((stock) => stockRow(stock, true)).join("")
          : `<tr><td colspan="5"><div class="empty-state compact"><strong>No stocks match.</strong><span>Try a different search or filter.</span></div></td></tr>`;
        bindWatchButtons();
        if (animate) staggerRows("#watchlist-table");
      };
      render(true);
      if ($("#watchlist-search")) $("#watchlist-search").oninput = () => render(false);
      chips.forEach((chip) =>
        chip.setAttribute("aria-pressed", String(chip.classList.contains("active"))),
      );
      chips.forEach(
        (chip) =>
          (chip.onclick = () => {
            chips.forEach((item) => {
              item.classList.remove("active");
              item.setAttribute("aria-pressed", "false");
            });
            chip.classList.add("active");
            chip.setAttribute("aria-pressed", "true");
            render(false);
          }),
      );
      if (statusDetail) {
        const avgDrift =
          watchlist.reduce(
            (total, item) => total + Number(item.deviation_percentage || 0),
            0,
          ) / watchlist.length;
        statusDetail.textContent = `${watchlist.length} tracked · avg drift ${percent(avgDrift)}`;
      }
    } catch (error) {
      toast(error.message, "error");
      $("#watchlist-table").innerHTML =
        `<tr><td colspan="5"><div class="error-state">${escapeHTML(error.message)}</div></td></tr>`;
    }
  }

  async function loadProfile(user) {
    try {
      const [summary, holdings, trades] = await Promise.all([
        api.summary(),
        api.portfolio(),
        api.trades(),
      ]);
      const invested = holdings.reduce(
        (total, item) => total + Number(item.invested_value || 0),
        0,
      );
      const pnlPercent = invested
        ? (Number(summary.unrealised_pnl) / invested) * 100
        : 0;
      const activity = trades.slice(0, 6);
      const profileRow = (label, value) =>
        `<div><span>${label}</span><strong>${value}</strong></div>`;
      $("#profile-content").innerHTML =
        `<section class="profile-hero"><div><span class="eyebrow">PROFILE / ACCOUNT</span><h1>Hi, ${escapeHTML(user.name || user.username)}</h1><p>Your paper-trading account.</p></div>${user.is_admin ? '<span class="account-status"><strong>Developer Account</strong><small>Trading disabled</small></span>' : ""}</section><section class="portfolio-summary panel"><span class="eyebrow">PORTFOLIO</span><strong class="portfolio-total">${money(summary.total_account_value)}</strong><span class="summary-label">Total account value</span><div class="summary-metrics"><div><span>Invested</span><strong>${money(invested)}</strong></div><div><span>Current value</span><strong>${money(summary.holdings_value)}</strong></div><div><span>P&L</span><strong class="${tone(summary.unrealised_pnl)}">${signed(summary.unrealised_pnl)} <small>(${percent(pnlPercent)})</small></strong></div></div></section><section class="profile-metrics"><div><span>Available cash</span><strong>${money(summary.cash_balance)}</strong></div><div><span>Invested value</span><strong>${money(invested)}</strong></div><div><span>Current value</span><strong>${money(summary.holdings_value)}</strong></div><div><span>Total P&L</span><strong class="${tone(summary.unrealised_pnl)}">${signed(summary.unrealised_pnl)}</strong></div></section><section class="profile-section">${valueChartCard()}</section><section class="profile-section"><div class="section-heading"><div><span class="eyebrow">YOUR BOOK</span><h2>Your holdings</h2></div></div><div class="table-wrap"><table><thead><tr><th>Stock</th><th>Qty</th><th>Avg. price</th><th>Simulated price</th><th>Current value</th><th>P&L</th></tr></thead><tbody>${holdings.length ? holdings.map((item) => `<tr><td data-label="Stock"><a class="stock-name" href="stock.html?id=${item.instrument_id}"><strong>${escapeHTML(item.symbol)}</strong><small>${escapeHTML(item.company_name || "")}</small></a></td><td data-label="Qty">${Number(item.quantity).toLocaleString("en-IN")}</td><td data-label="Avg. price">${money(item.avg_price)}</td><td data-label="Simulated price">${money(item.adjusted_price)}</td><td data-label="Current value">${money(item.market_value)}</td><td data-label="P&L" class="${tone(item.unrealised_pnl)}"><strong>${signed(item.unrealised_pnl)}</strong></td></tr>`).join("") : '<tr><td colspan="6"><div class="empty-state"><strong>Your portfolio is empty</strong><span>Start paper trading to build your portfolio.</span><a class="primary-button" href="index.html">Browse stocks</a></div></td></tr>'}</tbody></table></div></section><section class="profile-section"><div class="section-heading"><div><span class="eyebrow">ACTIVITY</span><h2>Recent activity</h2></div></div><div class="table-wrap"><table><thead><tr><th>Side</th><th>Stock</th><th>Quantity</th><th>Fill price</th><th>Price impact</th><th>Date</th></tr></thead><tbody>${activity.length ? activity.map((item) => `<tr><td data-label="Side"><span class="badge ${item.side.toLowerCase()}">${item.side}</span></td><td data-label="Stock"><strong>${escapeHTML(item.symbol)}</strong></td><td data-label="Quantity">${item.quantity}</td><td data-label="Fill price">${money(item.exec_price)}</td><td data-label="Price impact" class="${tone(item.price_impact)}">${signed(item.price_impact)}</td><td data-label="Date">${new Date(item.executed_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td></tr>`).join("") : '<tr><td colspan="6"><div class="empty-state"><strong>No recent activity</strong></div></td></tr>'}</tbody></table></div></section><section class="profile-section account-section"><div class="section-heading"><div><span class="eyebrow">ACCOUNT</span><h2>Account information</h2></div></div><div class="account-grid panel">${profileRow("Username", escapeHTML(user.username))}${profileRow("Email", escapeHTML(user.email))}${profileRow("Account type", user.is_admin ? "Developer · Trading disabled" : "Standard user")}${profileRow("Member since", new Date(user.created_at).toLocaleDateString("en-IN"))}</div></section>`;
      renderValueChart(summary);
    } catch (error) {
      $("#profile-content").innerHTML =
        `<div class="error-state">${escapeHTML(error.message)}</div>`;
    }
  }

  const INTERVALS = [
    { minutes: 1, label: "1m" },
    { minutes: 5, label: "5m" },
    { minutes: 15, label: "15m" },
    { minutes: 60, label: "1h" },
  ];
  const CHART_CAPTIONS = {
    candles: "MockFolio price candles. Volume bars are paper-trade shares filled in each bar.",
    line: "Teal is the MockFolio price; the second line is the real market price it drifts back toward.",
  };

  function quoteStats(stock) {
    return `<div><span>Open</span><strong>${money(stock.day_open)}</strong></div><div><span>High</span><strong>${money(stock.day_high)}</strong></div><div><span>Low</span><strong>${money(stock.day_low)}</strong></div><div><span>Volume</span><strong>${Number(stock.day_volume || 0).toLocaleString("en-IN")}</strong></div><div><span>Real price</span><strong id="stock-reference">${money(stock.raw_price)}</strong></div><div><span>Deviation</span><strong id="stock-deviation" class="${tone(stock.deviation)}">${percent(stock.deviation_percentage)}</strong></div>`;
  }

  function renderQuote(stock) {
    const change = Number(stock.adjusted_price) - Number(stock.day_open);
    const el = $("#stock-change");
    if (el) {
      el.className = `tv-change ${tone(change)}`;
      el.textContent = `${signed(change)} (${percent(stock.day_change_percentage)}) today`;
    }
    if ($("#tv-stats")) $("#tv-stats").innerHTML = quoteStats(stock);
  }

  async function loadStock() {
    const id = new URLSearchParams(location.search).get("id");
    try {
      const [stockData, watchlistData] = await Promise.all([api.stock(id), api.watchlist()]);
      let stock = stockData;
      watchlist = watchlistData;
      const starred = watchlist.some((item) => item.id === stock.instrument_id);
      const isAdmin = Boolean(currentUser?.is_admin);
      const tradePanel = isAdmin
        ? `<aside class="panel trade-panel read-only-panel"><span class="eyebrow">DEVELOPER ACCOUNT</span><h2>Trading disabled</h2><p class="helper">Developer accounts can inspect the simulated market but cannot place BUY or SELL orders.</p></aside>`
        : `<aside class="panel trade-panel"><div class="panel-heading"><div><span class="eyebrow">SIMULATED ORDER DESK</span><h2>Trade ${escapeHTML(stock.symbol)}</h2></div><span class="paper-mode-pill">${svgIcon(ICONS.lock)} Paper mode</span></div><div class="segmented"><button class="active" data-side="BUY">${svgIcon(ICONS.plusCircle)}Buy</button><button data-side="SELL">${svgIcon(ICONS.minusCircle)}Sell</button></div><label for="quantity">Quantity (shares)</label><div class="quantity-stepper"><button type="button" id="qty-decrease" aria-label="Decrease quantity">−</button><input id="quantity" type="number" min="1" step="1" value="10" inputmode="numeric" /><button type="button" id="qty-increase" aria-label="Increase quantity">+</button></div><div class="estimate"><div><span>Current price</span><strong id="estimate-price">${money(stock.adjusted_price)}</strong></div><div><span>Estimated amount</span><strong id="estimate-value">${money(stock.adjusted_price * 10)}</strong></div><div><span>Brokerage (0.1%)</span><strong id="estimate-brokerage">${money(stock.adjusted_price * 10 * 0.001)}</strong></div><div class="estimate-total"><span>Estimated total</span><strong id="estimate-total">${money(stock.adjusted_price * 10 * 1.001)}</strong></div></div><button class="primary-button full" id="trade-button">Buy stock</button><div id="trade-feedback" class="trade-feedback hidden"></div><p class="helper">Your fill price is determined by the server. A trade changes the shared simulated market price.</p></aside>`;
      const intervalButtons = INTERVALS.map(
        (item, i) => `<button type="button" data-interval="${item.minutes}" class="${i === 0 ? "active" : ""}" aria-pressed="${i === 0}">${item.label}</button>`,
      ).join("");
      $("#stock-content").innerHTML =
        `<header class="tv-header"><div class="tv-symbol"><span class="tv-avatar" aria-hidden="true">${escapeHTML(stock.symbol[0])}</span><div><h1>${escapeHTML(stock.symbol)} <span class="tv-exchange">${escapeHTML(stock.exchange || "NSE")}</span></h1><p>${escapeHTML(stock.company_name)} · ${escapeHTML(stock.sector || "")}</p></div><button class="table-action${starred ? " is-watched" : ""}" data-watch="${stock.instrument_id}" title="${starred ? "Remove from watchlist" : "Add to watchlist"}" aria-pressed="${starred}">${svgIcon(ICONS.watchlist)}</button></div><div class="tv-quote"><strong id="stock-price">${money(stock.adjusted_price)}</strong><em id="stock-change"></em><span class="tv-quote-label">MockFolio price · <span class="tv-live-dot"></span> live</span></div><div class="tv-stats" id="tv-stats"></div></header>` +
        `<div class="stock-grid"><section class="panel tv-chart-panel"><div class="tv-toolbar"><div class="tv-group" role="group" aria-label="Interval">${intervalButtons}</div><span class="tv-divider"></span><div class="tv-group" role="group" aria-label="Chart type"><button type="button" data-chart-view="candles" class="active" aria-pressed="true">${svgIcon(ICONS.candles)}Candles</button><button type="button" data-chart-view="line" aria-pressed="false">${svgIcon(ICONS.lines)}MockFolio vs Real</button></div></div><div class="tv-chart-wrap"><div id="tv-chart" role="img" aria-label="Price chart for ${escapeHTML(stock.symbol)}"></div><div class="tv-legend" id="tv-legend"></div><div id="chart-empty" class="tv-empty hidden">No price history yet. Candles appear as the market ticks.</div></div><p class="chart-caption" id="chart-caption">${CHART_CAPTIONS.candles}</p></section>${tradePanel}</div><section id="trade-result" class="trade-result hidden"></section>`;
      renderQuote(stock);

      let interval = INTERVALS[0];
      stockChart = window.MockfolioCharts?.createStockChart($("#tv-chart"), {
        symbol: stock.symbol,
        legend: $("#tv-legend"),
      });
      const loadSeries = async () => {
        const [adjusted, raw] = await Promise.all([
          api.history(stock.instrument_id, 1, interval.minutes, 300),
          api.history(stock.instrument_id, 0, interval.minutes, 300),
        ]);
        $("#chart-empty").classList.toggle("hidden", adjusted.length > 0);
        stockChart?.setData(adjusted, raw, interval.label);
      };
      await loadSeries();

      $$("[data-interval]").forEach(
        (button) =>
          (button.onclick = async () => {
            interval = INTERVALS.find((item) => item.minutes === Number(button.dataset.interval));
            $$("[data-interval]").forEach((b) => {
              b.classList.toggle("active", b === button);
              b.setAttribute("aria-pressed", String(b === button));
            });
            await loadSeries();
          }),
      );
      $$("[data-chart-view]").forEach(
        (button) =>
          (button.onclick = () => {
            const view = button.dataset.chartView;
            $$("[data-chart-view]").forEach((b) => {
              b.classList.toggle("active", b === button);
              b.setAttribute("aria-pressed", String(b === button));
            });
            stockChart?.setMode(view);
            $("#chart-caption").textContent = CHART_CAPTIONS[view];
          }),
      );

      // Live: pull the newest bars and the quote every few seconds.
      refreshStock = async () => {
        try {
          const [fresh, adjTail, rawTail] = await Promise.all([
            api.stock(stock.instrument_id),
            api.history(stock.instrument_id, 1, interval.minutes, 2),
            api.history(stock.instrument_id, 0, interval.minutes, 2),
          ]);
          stock = fresh;
          $("#stock-price").textContent = money(stock.adjusted_price);
          renderQuote(stock);
          if (adjTail.length) $("#chart-empty").classList.add("hidden");
          stockChart?.update(adjTail, rawTail);
        } catch {
          // A missed poll is harmless; the next one catches up.
        }
      };
      clearInterval(stockPoll);
      stockPoll = setInterval(() => document.hidden || refreshStock(), 5000);

      bindWatchButtons();
      if (!isAdmin) bindTrade(stock);
    } catch (error) {
      $("#stock-content").innerHTML = `<div class="error-state">${escapeHTML(error.message)}</div>`;
    }
  }

  function bindTrade(stock) {
    let side = "BUY";
    const quantity = $("#quantity");
    const clampQuantity = () => {
      const value = Math.max(1, Math.round(Number(quantity.value) || 1));
      quantity.value = String(value);
      return value;
    };
    const updateEstimate = () => {
      const amount =
        Number(stock.adjusted_price) * Number(quantity.value || 0);
      $("#estimate-price").textContent = money(stock.adjusted_price);
      $("#estimate-value").textContent = money(amount);
      $("#estimate-brokerage").textContent = money(amount * 0.001);
      $("#estimate-total").textContent = money(
        side === "BUY" ? amount * 1.001 : amount * 0.999,
      );
    };
    $$("[data-side]").forEach(
      (button) =>
        (button.onclick = () => {
          side = button.dataset.side;
          $$("[data-side]").forEach((item) =>
            item.classList.toggle("active", item === button),
          );
          $("#trade-button").textContent =
            `${side === "BUY" ? "Buy" : "Sell"} stock`;
          updateEstimate();
        }),
    );
    quantity.oninput = updateEstimate;
    $("#qty-decrease").onclick = () => {
      quantity.value = String(Math.max(1, clampQuantity() - 1));
      updateEstimate();
    };
    $("#qty-increase").onclick = () => {
      quantity.value = String(clampQuantity() + 1);
      updateEstimate();
    };
    $("#trade-button").onclick = async () => {
      const amount = Number(quantity.value);
      if (!Number.isInteger(amount) || amount <= 0) {
        toast("Enter a quantity greater than zero.", "error");
        return;
      }
      const button = $("#trade-button");
      button.disabled = true;
      button.classList.add("is-loading");
      button.textContent = "Executing...";
      $("#trade-feedback")?.classList.add("hidden");
      try {
        const result = await api.trade(side, {
          instrument_id: stock.instrument_id,
          quantity: amount,
          client_order_id: crypto.randomUUID(),
        });
        const impact = Number(result.price_impact);
        const arrow = impact > 0 ? "↑" : impact < 0 ? "↓" : "–";
        $("#trade-result").className = "trade-result visible";
        $("#trade-result").innerHTML =
          `<span class="success-mark">${svgIcon(ICONS.check)}</span><div><span class="eyebrow">TRADE EXECUTED</span><h2>${side} ${escapeHTML(stock.symbol)}</h2><div class="result-grid"><div><span>Fill price</span><strong>${money(result.exec_price)}</strong></div><div><span>Total cost</span><strong>${money(result.total_value)}</strong></div><div><span>Brokerage</span><strong>${money(result.brokerage)}</strong></div><div><span>Price impact</span><strong class="${tone(impact)}">${signed(impact)}</strong></div><div><span>New deviation</span><strong class="${tone(result.deviation_after_trade)}">${signed(result.deviation_after_trade)}</strong></div></div><div class="impact-story"><span>Before ${money(result.pre_trade_price)}</span><b>${arrow} ${side} IMPACT ${signed(impact)}</b><span>After ${money(result.exec_price)}</span></div></div>`;
        toast("Trade executed successfully", "success");
        const previousPrice = Number(stock.adjusted_price);
        stock = await api.stock(stock.instrument_id);
        updateEstimate();
        const priceEl = $("#stock-price");
        if (priceEl) {
          tweenNumber(
            priceEl,
            previousPrice,
            Number(stock.adjusted_price),
            money,
          );
          const flashClass =
            Number(stock.adjusted_price) >= previousPrice
              ? "price-flash-up"
              : "price-flash-down";
          priceEl.classList.remove("price-flash-up", "price-flash-down");
          void priceEl.offsetWidth;
          priceEl.classList.add(flashClass);
          setTimeout(() => priceEl.classList.remove(flashClass), 650);
        }
        refreshStock?.();
      } catch (error) {
        const feedback = $("#trade-feedback");
        if (feedback) {
          feedback.className = "trade-feedback error visible";
          feedback.innerHTML = `<strong>${side === "SELL" ? "Sell unavailable" : "Order unavailable"}</strong><span>${escapeHTML(error.message)}</span>`;
        }
        toast(error.message, "error");
      } finally {
        button.disabled = false;
        button.classList.remove("is-loading");
        button.textContent = `${side === "BUY" ? "Buy" : "Sell"} stock`;
      }
    };
  }

  function adminSummaryCard(label, value, caption, valueTone) {
    return `<div class="stat"><span class="stat-label">${label}</span><strong class="stat-value${valueTone ? ` ${valueTone}` : ""}">${value}</strong>${caption ? `<span class="stat-caption">${caption}</span>` : ""}</div>`;
  }

  // Native <dialog> confirm, shared shape for both destructive admin
  // actions. Returns nothing; wires cancel/backdrop/Escape to just close.
  function openConfirmDialog(dialog) {
    dialog.showModal();
    dialog.addEventListener(
      "click",
      (event) => {
        if (event.target === dialog) dialog.close();
      },
      { once: true },
    );
  }

  async function loadDeveloper() {
    try {
      const [users, summary] = await Promise.all([
        api.adminUsers(),
        api.adminSummary(),
      ]);
      $("#developer-stats").innerHTML = [
        adminSummaryCard("Total users", summary.total_users, "Registered accounts"),
        adminSummaryCard("Total trades", summary.total_trades, "Executed"),
        adminSummaryCard("Total orders", summary.total_orders, "Placed"),
        adminSummaryCard("Active stocks", summary.active_stocks, "In the simulation"),
      ].join("");
      const render = (animate) => {
        const query = $("#user-search").value.trim().toLowerCase();
        const filtered = users.filter((item) =>
          `${item.username} ${item.email}`.toLowerCase().includes(query),
        );
        $("#users-table").innerHTML = filtered.length
          ? filtered
              .map(
                (item) =>
                  `<tr><td data-label="Username"><a class="user-name-link" href="developer-user.html?id=${item.id}">${escapeHTML(item.username)}</a>${item.is_admin ? '<span class="badge admin">ADMIN</span>' : ""}</td><td data-label="Email">${escapeHTML(item.email)}</td><td data-label="Joined">${new Date(item.created_at).toLocaleDateString("en-IN")}</td><td data-label="Cash balance">${money(item.cash_balance)}</td><td data-label="Portfolio">${money(item.portfolio_value)}</td><td data-label="P&L" class="${tone(item.unrealised_pnl)}">${signed(item.unrealised_pnl)}</td><td data-label="Trades">${item.trade_count}</td></tr>`,
              )
              .join("")
          : `<tr><td colspan="7"><div class="empty-state"><strong>No users found.</strong></div></td></tr>`;
        if (animate) staggerRows("#users-table");
      };
      $("#user-search").oninput = () => render(false);
      render(true);

      // Reset market: destructive, admin-only, requires typing a phrase to
      // confirm (§ developer pages, Phase 7). Replaces (not appends) into a
      // dedicated container so a re-render after a successful reset can't
      // leave duplicate dialogs/IDs behind.
      $("#developer-actions").innerHTML =
        `<section class="panel system-controls"><div><span class="eyebrow">SYSTEM CONTROL</span><h2>Reset the simulated market</h2><p class="helper">Wipes all order books, resets every account to ₹1,00,000 virtual cash, and re-anchors MockFolio prices to the reference price. This cannot be undone.</p></div><button class="ghost-button danger" id="open-reset-market">${svgIcon(ICONS.warning)}Reset market</button></section><dialog class="confirm-dialog" id="reset-market-dialog"><div class="confirm-dialog-icon warning">${svgIcon(ICONS.warning)}</div><h3>Reset the simulated market?</h3><p class="helper">This archives <strong>${summary.total_trades}</strong> executed trades and <strong>${summary.total_orders}</strong> orders, and restores all <strong>${summary.total_users}</strong> accounts to ₹1,00,000 virtual cash. This cannot be undone.</p><label for="reset-market-confirm-input">Type <strong>CONFIRM-RESET</strong> to proceed</label><input id="reset-market-confirm-input" autocomplete="off" placeholder="CONFIRM-RESET" /><div class="confirm-dialog-actions"><button type="button" class="ghost-button" id="reset-market-cancel">Cancel</button><button type="button" class="primary-button danger" id="reset-market-confirm" disabled>Reset market</button></div></dialog>`;
      const resetDialog = $("#reset-market-dialog");
      const resetInput = $("#reset-market-confirm-input");
      const resetConfirm = $("#reset-market-confirm");
      $("#open-reset-market").onclick = () => {
        resetInput.value = "";
        resetConfirm.disabled = true;
        openConfirmDialog(resetDialog);
        resetInput.focus();
      };
      $("#reset-market-cancel").onclick = () => resetDialog.close();
      resetInput.oninput = () => {
        resetConfirm.disabled = resetInput.value.trim() !== "CONFIRM-RESET";
      };
      resetConfirm.onclick = async () => {
        resetConfirm.disabled = true;
        resetConfirm.classList.add("is-loading");
        try {
          await api.resetMarket();
          resetDialog.close();
          toast("Market reset. Every account is back to ₹1,00,000.", "success");
          loadDeveloper();
        } catch (error) {
          toast(error.message, "error");
          resetConfirm.disabled = false;
        } finally {
          resetConfirm.classList.remove("is-loading");
        }
      };
    } catch (error) {
      $("#developer-content").innerHTML =
        `<div class="error-state">${escapeHTML(error.message)}</div>`;
    }
  }

  async function loadDeveloperUser() {
    const id = new URLSearchParams(location.search).get("id");
    try {
      const [detail, trades, orders] = await Promise.all([
        api.adminUser(id),
        api.adminUserTrades(id),
        api.adminUserOrders(id),
      ]);
      const user = detail.user;
      const account = detail.account;
      const row = (label, value) =>
        `<div><span>${label}</span><strong>${value}</strong></div>`;
      const holdings = detail.holdings.length
        ? detail.holdings
            .map(
              (item) =>
                `<tr><td data-label="Stock"><strong>${escapeHTML(item.symbol)}</strong><small>${escapeHTML(item.company_name)}</small></td><td data-label="Quantity">${item.quantity}</td><td data-label="Average buy">${money(item.avg_price)}</td><td data-label="Current price">${money(item.adjusted_price)}</td><td data-label="P&L" class="${tone(item.unrealised_pnl)}">${signed(item.unrealised_pnl)}</td></tr>`,
            )
            .join("")
        : '<tr><td colspan="5"><div class="empty-state"><strong>No current holdings.</strong></div></td></tr>';
      const tradeRows = trades.length
        ? trades
            .map(
              (item) =>
                `<tr><td data-label="Date">${new Date(item.executed_at).toLocaleString("en-IN")}</td><td data-label="Stock">${escapeHTML(item.symbol)}</td><td data-label="Side"><span class="badge ${item.side.toLowerCase()}">${item.side}</span></td><td data-label="Quantity">${item.quantity}</td><td data-label="Fill price">${money(item.exec_price)}</td><td data-label="Brokerage">${money(item.brokerage)}</td><td data-label="Impact" class="${tone(item.price_impact)}">${signed(item.price_impact)}</td><td data-label="Before">${money(item.pre_trade_price)}</td><td data-label="After">${money(item.exec_price)}</td></tr>`,
            )
            .join("")
        : '<tr><td colspan="9"><div class="empty-state"><strong>This user has not made any trades yet.</strong></div></td></tr>';
      const orderRows = orders.length
        ? orders
            .map(
              (item) =>
                `<tr><td data-label="Date">${new Date(item.created_at).toLocaleString("en-IN")}</td><td data-label="Stock">${escapeHTML(item.symbol)}</td><td data-label="Type"><span class="badge ${item.order_type.toLowerCase()}">${item.order_type}</span></td><td data-label="Quantity">${item.quantity}</td><td data-label="Limit price">${item.limit_price ? money(item.limit_price) : "—"}</td><td data-label="Status"><span class="badge filled">${item.status}</span></td></tr>`,
            )
            .join("")
        : '<tr><td colspan="6"><div class="empty-state"><strong>No orders yet.</strong></div></td></tr>';
      const accountStats = [
        adminSummaryCard("Cash balance", money(account.cash_balance)),
        adminSummaryCard("Portfolio value", money(account.portfolio_value)),
        adminSummaryCard("Total account value", money(account.total_account_value)),
        adminSummaryCard(
          "Total P&L",
          signed(account.unrealised_pnl),
          undefined,
          tone(account.unrealised_pnl),
        ),
        adminSummaryCard("Trade count", trades.length),
        adminSummaryCard("Order count", orders.length),
      ].join("");
      $("#developer-user-content").innerHTML =
        `<section class="user-hero panel"><span class="avatar">${escapeHTML(user.username[0]?.toUpperCase())}</span><div><span class="eyebrow">USER PROFILE</span><h1>${escapeHTML(user.username)}</h1><p>${escapeHTML(user.email)}</p></div></section><section class="profile-grid panel profile-table">${row("User ID", user.id)}${row("Username", escapeHTML(user.username))}${row("Name", escapeHTML(user.username))}${row("Email", escapeHTML(user.email))}${row("Account type", user.is_admin ? "Developer / Admin" : "Standard user")}${row("Joined", new Date(user.created_at).toLocaleString("en-IN"))}</section><section class="section-heading spaced"><div><span class="eyebrow">ACCOUNT SUMMARY</span><h2>Account overview</h2></div></section><section class="stats">${accountStats}</section><section class="section-heading spaced"><div><span class="eyebrow">CURRENT HOLDINGS</span><h2>Positions</h2></div></section><div class="table-wrap"><table><thead><tr><th>Stock</th><th>Quantity</th><th>Average buy</th><th>Current price</th><th>P&L</th></tr></thead><tbody>${holdings}</tbody></table></div><section class="section-heading spaced"><div><span class="eyebrow">TRADES</span><h2>Trade history</h2></div></section><div class="table-wrap"><table><thead><tr><th>Date</th><th>Stock</th><th>Side</th><th>Quantity</th><th>Fill price</th><th>Brokerage</th><th>Impact</th><th>Before</th><th>After</th></tr></thead><tbody>${tradeRows}</tbody></table></div><section class="section-heading spaced"><div><span class="eyebrow">ORDERS</span><h2>Order history</h2></div></section><div class="table-wrap"><table><thead><tr><th>Date</th><th>Stock</th><th>Type</th><th>Quantity</th><th>Requested price</th><th>Status</th></tr></thead><tbody>${orderRows}</tbody></table></div><section class="panel system-controls"><div><span class="eyebrow">ADMINISTRATIVE CONTROLS</span><h2>Reset this account</h2><p class="helper">Liquidates all open holdings, clears any orders, and restores ${escapeHTML(user.username)}'s balance to ₹1,00,000 virtual cash. This cannot be undone.</p></div><button class="ghost-button danger" id="open-reset-account">${svgIcon(ICONS.warning)}Reset account</button></section><dialog class="confirm-dialog" id="reset-account-dialog"><div class="confirm-dialog-icon warning">${svgIcon(ICONS.warning)}</div><h3>Reset ${escapeHTML(user.username)}'s account?</h3><p class="helper">This liquidates ${detail.holdings.length} holding${detail.holdings.length === 1 ? "" : "s"}, clears any open orders, and sets virtual cash back to ₹1,00,000. This cannot be undone.</p><div class="confirm-dialog-actions"><button type="button" class="ghost-button" id="reset-account-cancel">Cancel</button><button type="button" class="primary-button danger" id="reset-account-confirm">Reset account</button></div></dialog>`;
      const resetAccountDialog = $("#reset-account-dialog");
      $("#open-reset-account").onclick = () => openConfirmDialog(resetAccountDialog);
      $("#reset-account-cancel").onclick = () => resetAccountDialog.close();
      $("#reset-account-confirm").onclick = async () => {
        const confirmButton = $("#reset-account-confirm");
        confirmButton.disabled = true;
        confirmButton.classList.add("is-loading");
        try {
          await api.resetUser(id);
          resetAccountDialog.close();
          toast(`${user.username}'s account has been reset.`, "success");
          loadDeveloperUser();
        } catch (error) {
          toast(error.message, "error");
          confirmButton.disabled = false;
        } finally {
          confirmButton.classList.remove("is-loading");
        }
      };
    } catch (error) {
      $("#developer-user-content").innerHTML =
        `<div class="error-state">${escapeHTML(error.message)}</div>`;
    }
  }

  async function start() {
    try {
      const user = await api.me();
      currentUser = user;
      renderShell(user);
      if (page === "market") await loadMarket();
      if (page === "portfolio") await loadPortfolio();
      if (page === "orders") await loadOrders();
      if (page === "watchlist") await loadWatchlist();
      if (page === "profile") await loadProfile(user);
      if (page === "stock") await loadStock();
      if (page === "developer") await loadDeveloper();
      if (page === "developer-user") await loadDeveloperUser();
    } catch (error) {
      toast(error.message, "error");
    }
  }
  window.addEventListener("mockfolio-theme-change", updateThemeToggle);
  start();
})();
