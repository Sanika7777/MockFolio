(() => {
  const api = window.MockfolioApi;
  const page = document.body.dataset.page;
  if (!localStorage.getItem("token")) {
    location.href = "login.html";
    return;
  }

  let stocks = [];
  let watchlist = [];
  let priceChart;
  let allocationChart, investedChart, pnlChart;
  let lastHoldings, lastCashBalance;
  let currentUser;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const money = api.formatINR;
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
    if (priceChart) applyChartTheme();
    if (allocationChart) renderAllocationChart(lastHoldings, lastCashBalance);
    if (investedChart) renderInvestedVsCurrentChart(lastHoldings);
    if (pnlChart) renderPnlByHoldingChart(lastHoldings);
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
    const pnl = Number(summary.total_pnl || 0);
    const pnlPercent = (pnl / 100000) * 100;
    const arrow = pnl > 0 ? "▲" : pnl < 0 ? "▼" : "–";
    return [
      {
        label: "Total account value",
        value: money(summary.total_account_value),
        caption: `Initial ${money(100000)}`,
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
    const href = `stock.html?id=${stock.id}`;
    const arrow = deviation > 0 ? "▲" : deviation < 0 ? "▼" : "–";
    const actionLabel = currentUser?.is_admin ? "View" : "Trade";
    const sectorTag = stock.sector
      ? `<span class="sector-tag">${escapeHTML(stock.sector)}</span>`
      : "";
    return `<tr><td data-label="Stock"><a class="stock-name" href="${href}"><span class="stock-name-top"><strong>${escapeHTML(stock.symbol)}</strong>${sectorTag}</span><small>${escapeHTML(stock.company_name)}</small></a></td><td data-label="MockFolio price"><strong class="market-price">${money(stock.simulated_price)}</strong><small>MockFolio price</small></td><td data-label="Reference price">${money(stock.reference_price)}</td><td data-label="Deviation"><div class="deviation-cell"><div class="deviation-text"><span class="deviation-chip ${tone(deviation)}">${arrow} ${signed(deviation)}</span><small class="${tone(deviation)}">${percent(stock.deviation_percentage)}</small></div><canvas class="sparkline" data-sparkline="${stock.id}" width="72" height="28" aria-hidden="true"></canvas></div></td><td data-label="Action"><div class="row-actions"><button class="table-action${starred ? " is-watched" : ""}" data-watch="${stock.id}" title="${starred ? "Remove from watchlist" : "Add to watchlist"}" aria-pressed="${starred}">${svgIcon(ICONS.watchlist)}</button><a class="trade-link" href="${href}">${actionLabel}</a></div></td></tr>`;
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
            else if (page === "market") await loadMarket();
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
      const render = (animate) => {
        const query = $("#stock-search").value.trim().toLowerCase();
        const watchIds = new Set(watchlist.map((item) => item.id));
        const mode = $("#market-filter").value;
        const filtered = stocks.filter(
          (stock) =>
            `${stock.symbol} ${stock.company_name}`
              .toLowerCase()
              .includes(query) &&
            (mode !== "watchlist" || watchIds.has(stock.id)),
        );
        $("#market-table").innerHTML = filtered.length
          ? filtered
              .map((stock) => stockRow(stock, watchIds.has(stock.id)))
              .join("")
          : `<tr><td colspan="5"><div class="empty-state compact"><strong>${query ? "No stocks match your search." : mode === "watchlist" ? "No stocks in your watchlist." : "No stocks available."}</strong><span>${query ? "Try a different symbol or company name." : "The simulated market has no active stocks right now."}</span></div></td></tr>`;
        bindWatchButtons();
        initSparklines();
        if (animate) staggerRows("#market-table");
      };
      render(true);
      $("#market-status-detail").textContent =
        `${stocks.length} active stocks · Simulation active`;
      $("#stock-search").oninput = () => render(false);
      $("#market-filter").onchange = () => render(false);
      renderStats(summaryStats(summary, holdings.length));
    } catch (error) {
      $("#market-table").innerHTML =
        `<tr><td colspan="5"><div class="error-state">${escapeHTML(error.message)}</div></td></tr>`;
    }
  }

  function allocationChartCard() {
    return `<div class="panel donut-card"><div class="panel-heading"><div><span class="eyebrow">ALLOCATION</span><h2>Asset allocation</h2></div></div><div class="donut-wrap"><div class="donut-canvas-wrap"><canvas id="allocation-chart" role="img" aria-label="Doughnut chart of cash and holdings as a share of total account value"></canvas><div class="donut-center"><div class="donut-center-inner"><strong id="allocation-total">₹0</strong><span>Total value</span></div></div></div><ul class="donut-legend" id="allocation-legend"></ul></div></div>`;
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
        chartsHost.innerHTML =
          allocationChartCard() +
          (holdings.length
            ? `<div class="panel chart-card"><div class="panel-heading"><div><span class="eyebrow">DEPLOYMENT</span><h2>Invested vs current</h2></div></div><div class="chart-card-canvas"><canvas id="invested-chart" role="img" aria-label="Bar chart comparing invested capital and current market value"></canvas></div></div><div class="panel chart-card wide"><div class="panel-heading"><div><span class="eyebrow">PERFORMANCE</span><h2>P&L by holding</h2></div></div><div class="chart-card-canvas"><canvas id="pnl-chart" role="img" aria-label="Horizontal bar chart of unrealized profit and loss per holding"></canvas></div></div>`
            : "");
        renderAllocationChart(holdings, summary.cash_balance);
        if (holdings.length) {
          renderInvestedVsCurrentChart(holdings);
          renderPnlByHoldingChart(holdings);
        }
      }
      $("#portfolio-table").innerHTML = holdings.length
        ? holdings
            .map(
              (item) =>
                `<tr><td data-label="Stock"><a class="stock-name" href="stock.html?id=${item.stock_id}"><strong>${escapeHTML(item.symbol)}</strong></a></td><td data-label="Quantity">${Number(item.quantity).toLocaleString("en-IN")}</td><td data-label="Average buy">${money(item.average_buy_price)}</td><td data-label="Current price">${money(item.simulated_price)}</td><td data-label="Invested">${money(item.invested_value)}</td><td data-label="Current value">${money(item.current_value)}</td><td data-label="P&L" class="${tone(item.profit_loss)}"><strong>${signed(item.profit_loss)}</strong><small>${percent((Number(item.profit_loss) / Number(item.invested_value || 1)) * 100)}</small></td></tr>`,
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
                `<tr><td data-label="Date">${new Date(item.created_at).toLocaleString("en-IN")}</td><td data-label="Stock"><strong>${escapeHTML(item.symbol)}</strong></td><td data-label="Type"><span class="badge ${item.order_type.toLowerCase()}">${item.order_type}</span></td><td data-label="Quantity">${item.quantity}</td><td data-label="Requested price">${money(item.requested_price)}</td><td data-label="Status"><span class="badge filled">${item.status}</span></td></tr>`,
            )
            .join("")
        : `<tr><td colspan="6"><div class="empty-state"><strong>No orders yet</strong><span>Your completed orders will appear here.</span></div></td></tr>`;
      $("#trades-table").innerHTML = trades.length
        ? trades
            .map(
              (item) =>
                `<tr><td data-label="Date">${new Date(item.created_at).toLocaleString("en-IN")}</td><td data-label="Stock"><strong>${escapeHTML(item.symbol)}</strong></td><td data-label="Side"><span class="badge ${item.side.toLowerCase()}">${item.side}</span></td><td data-label="Quantity">${item.quantity}</td><td data-label="Fill price">${money(item.fill_price)}</td><td data-label="Brokerage">${money(item.brokerage)}</td><td data-label="Price impact" class="${tone(item.price_impact)}">${signed(item.price_impact)}</td></tr>`,
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
        initSparklines();
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
        ? (Number(summary.total_pnl) / invested) * 100
        : 0;
      const activity = trades.slice(0, 6);
      const profileRow = (label, value) =>
        `<div><span>${label}</span><strong>${value}</strong></div>`;
      $("#profile-content").innerHTML =
        `<section class="profile-hero"><div><span class="eyebrow">PROFILE / ACCOUNT</span><h1>Hi, ${escapeHTML(user.name || user.username)}</h1><p>Your paper-trading account.</p></div>${user.is_admin ? '<span class="account-status"><strong>Developer Account</strong><small>Trading disabled</small></span>' : ""}</section><section class="portfolio-summary panel"><span class="eyebrow">PORTFOLIO</span><strong class="portfolio-total">${money(summary.total_account_value)}</strong><span class="summary-label">Total account value</span><div class="summary-metrics"><div><span>Invested</span><strong>${money(invested)}</strong></div><div><span>Current value</span><strong>${money(summary.holdings_value)}</strong></div><div><span>P&L</span><strong class="${tone(summary.total_pnl)}">${signed(summary.total_pnl)} <small>(${percent(pnlPercent)})</small></strong></div></div></section><section class="profile-metrics"><div><span>Available cash</span><strong>${money(summary.cash_balance)}</strong></div><div><span>Invested value</span><strong>${money(invested)}</strong></div><div><span>Current value</span><strong>${money(summary.holdings_value)}</strong></div><div><span>Total P&L</span><strong class="${tone(summary.total_pnl)}">${signed(summary.total_pnl)}</strong></div></section><section class="profile-section">${allocationChartCard()}</section><section class="profile-section"><div class="section-heading"><div><span class="eyebrow">YOUR BOOK</span><h2>Your holdings</h2></div></div><div class="table-wrap"><table><thead><tr><th>Stock</th><th>Qty</th><th>Avg. price</th><th>Simulated price</th><th>Current value</th><th>P&L</th></tr></thead><tbody>${holdings.length ? holdings.map((item) => `<tr><td data-label="Stock"><a class="stock-name" href="stock.html?id=${item.stock_id}"><strong>${escapeHTML(item.symbol)}</strong><small>${escapeHTML(item.company_name || "")}</small></a></td><td data-label="Qty">${Number(item.quantity).toLocaleString("en-IN")}</td><td data-label="Avg. price">${money(item.average_buy_price)}</td><td data-label="Simulated price">${money(item.simulated_price)}</td><td data-label="Current value">${money(item.current_value)}</td><td data-label="P&L" class="${tone(item.profit_loss)}"><strong>${signed(item.profit_loss)}</strong></td></tr>`).join("") : '<tr><td colspan="6"><div class="empty-state"><strong>Your portfolio is empty</strong><span>Start paper trading to build your portfolio.</span><a class="primary-button" href="index.html">Browse stocks</a></div></td></tr>'}</tbody></table></div></section><section class="profile-section"><div class="section-heading"><div><span class="eyebrow">ACTIVITY</span><h2>Recent activity</h2></div></div><div class="table-wrap"><table><thead><tr><th>Side</th><th>Stock</th><th>Quantity</th><th>Fill price</th><th>Price impact</th><th>Date</th></tr></thead><tbody>${activity.length ? activity.map((item) => `<tr><td data-label="Side"><span class="badge ${item.side.toLowerCase()}">${item.side}</span></td><td data-label="Stock"><strong>${escapeHTML(item.symbol)}</strong></td><td data-label="Quantity">${item.quantity}</td><td data-label="Fill price">${money(item.fill_price)}</td><td data-label="Price impact" class="${tone(item.price_impact)}">${signed(item.price_impact)}</td><td data-label="Date">${new Date(item.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td></tr>`).join("") : '<tr><td colspan="6"><div class="empty-state"><strong>No recent activity</strong></div></td></tr>'}</tbody></table></div></section><section class="profile-section account-section"><div class="section-heading"><div><span class="eyebrow">ACCOUNT</span><h2>Account information</h2></div></div><div class="account-grid panel">${profileRow("Username", escapeHTML(user.username))}${profileRow("Email", escapeHTML(user.email))}${profileRow("Account type", user.is_admin ? "Developer · Trading disabled" : "Standard user")}${profileRow("Member since", new Date(user.created_at).toLocaleDateString("en-IN"))}</div></section>`;
      renderAllocationChart(holdings, summary.cash_balance);
    } catch (error) {
      $("#profile-content").innerHTML =
        `<div class="error-state">${escapeHTML(error.message)}</div>`;
    }
  }

  function drawChart(history) {
    if (!history.length) {
      $("#price-chart").classList.add("hidden");
      $("#chart-empty").classList.remove("hidden");
      return;
    }
    $("#price-chart").classList.remove("hidden");
    $("#chart-empty").classList.add("hidden");
    const points = history.slice().reverse();
    priceChart = new Chart($("#price-chart"), {
      type: "line",
      data: {
        labels: points.map((item) =>
          new Date(item.recorded_at).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        ),
        datasets: [
          {
            label: "MockFolio Price",
            data: points.map((item) => item.simulated_price),
            fill: true,
            tension: 0.25,
            pointRadius: 2,
          },
          {
            label: "Reference Price",
            data: points.map((item) => item.reference_price),
            fill: false,
            tension: 0.25,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: true, position: "bottom" } },
        scales: {
          y: {
            ticks: { callback: (value) => money(value) },
            grid: {},
          },
          x: { grid: { display: false } },
        },
      },
    });
    // Colours are never hard-coded: they're read from the theme's CSS
    // variables here, immediately after creation, so the very first paint
    // is already themed and the toggle can re-theme it live (Phase 5 §2).
    applyChartTheme();
  }

  function applyChartTheme() {
    if (!priceChart) return;
    const styles = getComputedStyle(document.documentElement);
    const text = styles.getPropertyValue("--muted").trim();
    const grid = styles.getPropertyValue("--border").trim();
    const primary = styles.getPropertyValue("--primary").trim();
    const reference = styles.getPropertyValue("--reference").trim();
    const [priceDataset, referenceDataset] = priceChart.data.datasets;
    priceDataset.borderColor = primary;
    priceDataset.backgroundColor = `color-mix(in srgb, ${primary} 12%, transparent)`;
    priceDataset.pointBackgroundColor = primary;
    referenceDataset.borderColor = reference;
    referenceDataset.pointBackgroundColor = reference;
    referenceDataset.borderDash = [6, 4];
    priceChart.options.scales.y.ticks.color = text;
    priceChart.options.scales.x.ticks.color = text;
    priceChart.options.scales.y.grid.color = grid;
    priceChart.options.scales.x.grid.color = grid;
    priceChart.options.plugins.legend.labels = { color: text };
    priceChart.options.plugins.tooltip = {
      backgroundColor: styles.getPropertyValue("--surface").trim(),
      titleColor: styles.getPropertyValue("--text").trim(),
      bodyColor: text,
      borderColor: grid,
      borderWidth: 1,
    };
    priceChart.update("none");
  }

  const reducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Anchor tooltips above the chart instead of at the hovered point, so a
  // doughnut's tooltip never lands on top of the centre total (below).
  if (typeof Chart !== "undefined" && !Chart.Tooltip.positioners.top) {
    Chart.Tooltip.positioners.top = (items) => {
      const chart = items[0]?.chart;
      if (!chart) return false;
      return {
        x: chart.chartArea.left + chart.chartArea.width / 2,
        y: chart.chartArea.top,
      };
    };
  }

  // Allocation donut (§5): Cash + top 4 holdings by current value, any
  // remainder grouped into "Other". Shared by Portfolio and Profile, which
  // never render at the same time, so the same element IDs are reused.
  function renderAllocationChart(holdings, cashBalance) {
    const canvas = $("#allocation-chart");
    if (!canvas || typeof Chart === "undefined") return;
    lastHoldings = holdings;
    lastCashBalance = cashBalance;
    const styles = getComputedStyle(document.documentElement);
    const colors = [1, 2, 3, 4, 5].map((n) =>
      styles.getPropertyValue(`--chart-${n}`).trim(),
    );
    const sorted = holdings
      .slice()
      .sort((a, b) => Number(b.current_value) - Number(a.current_value));
    const top = sorted.slice(0, 4);
    const otherValue = sorted
      .slice(4)
      .reduce((sum, item) => sum + Number(item.current_value || 0), 0);
    const slices = [
      { label: "Cash", value: Number(cashBalance) || 0 },
      ...top.map((item) => ({
        label: item.symbol,
        value: Number(item.current_value) || 0,
      })),
    ];
    if (otherValue > 0) slices.push({ label: "Other", value: otherValue });
    const total = slices.reduce((sum, s) => sum + s.value, 0);
    if (allocationChart) allocationChart.destroy();
    allocationChart = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: slices.map((s) => s.label),
        datasets: [
          {
            data: slices.map((s) => s.value),
            backgroundColor: slices.map((_, i) => colors[i % colors.length]),
            borderColor: styles.getPropertyValue("--surface").trim(),
            borderWidth: 3,
          },
        ],
      },
      options: {
        cutout: "68%",
        // Without these, Chart.js falls back to its default aspect-ratio
        // sizing, which can size the canvas's internal drawing buffer
        // differently from the CSS box it's actually rendered at — the
        // ring is still drawn, but hover hit-testing lands in the wrong
        // place (or nowhere), so the tooltip never appears. Locking to the
        // CSS-defined container fixes both hover and the visual size.
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            // Pinned above the chart (see the custom "top" positioner
            // registered above) so it never sits over the centre total.
            position: "top",
            yAlign: "bottom",
            caretSize: 0,
            displayColors: false,
            padding: 8,
            backgroundColor: styles.getPropertyValue("--surface").trim(),
            titleColor: styles.getPropertyValue("--text").trim(),
            bodyColor: styles.getPropertyValue("--muted").trim(),
            borderColor: styles.getPropertyValue("--border").trim(),
            borderWidth: 1,
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${money(ctx.parsed)}`,
            },
          },
        },
        animation: reducedMotion() ? false : { duration: 700, animateRotate: true },
      },
    });
    const totalEl = $("#allocation-total");
    if (totalEl) totalEl.textContent = money(total);
    const legend = $("#allocation-legend");
    if (legend) {
      legend.innerHTML = slices
        .map((s, i) => {
          const pct = total ? ((s.value / total) * 100).toFixed(1) : "0.0";
          return `<li class="donut-legend-item" data-index="${i}"><span class="swatch" style="background:${colors[i % colors.length]}"></span><span class="name">${escapeHTML(s.label)}</span><span class="pct">${pct}%</span><span class="value">${money(s.value)}</span></li>`;
        })
        .join("");
      $$(".donut-legend-item").forEach(
        (row) =>
          (row.onclick = () => {
            $$(".donut-legend-item").forEach((item) =>
              item.classList.remove("active"),
            );
            row.classList.add("active");
            allocationChart.setActiveElements([
              { datasetIndex: 0, index: Number(row.dataset.index) },
            ]);
            allocationChart.update();
          }),
      );
    }
  }

  // Invested vs current value (§5), Portfolio page only.
  function renderInvestedVsCurrentChart(holdings) {
    const canvas = $("#invested-chart");
    if (!canvas || typeof Chart === "undefined") return;
    const styles = getComputedStyle(document.documentElement);
    const invested = holdings.reduce(
      (sum, item) => sum + Number(item.invested_value || 0),
      0,
    );
    const current = holdings.reduce(
      (sum, item) => sum + Number(item.current_value || 0),
      0,
    );
    if (investedChart) investedChart.destroy();
    investedChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: ["Invested", "Current"],
        datasets: [
          {
            data: [invested, current],
            backgroundColor: [
              styles.getPropertyValue("--reference").trim(),
              styles.getPropertyValue("--primary").trim(),
            ],
            borderRadius: 6,
            maxBarThickness: 56,
          },
        ],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          y: {
            ticks: {
              color: styles.getPropertyValue("--muted").trim(),
              callback: (value) => money(value),
            },
            grid: { color: styles.getPropertyValue("--border").trim() },
          },
          x: {
            ticks: { color: styles.getPropertyValue("--text").trim() },
            grid: { display: false },
          },
        },
        animation: reducedMotion() ? false : { duration: 700 },
      },
    });
  }

  // P&L by holding (§5), Portfolio page only. Green >= 0, red < 0.
  function renderPnlByHoldingChart(holdings) {
    const canvas = $("#pnl-chart");
    if (!canvas || typeof Chart === "undefined") return;
    const styles = getComputedStyle(document.documentElement);
    const positive = styles.getPropertyValue("--positive").trim();
    const negative = styles.getPropertyValue("--negative").trim();
    canvas.parentElement.style.height = `${Math.max(140, holdings.length * 40)}px`;
    if (pnlChart) pnlChart.destroy();
    pnlChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: holdings.map((item) => item.symbol),
        datasets: [
          {
            data: holdings.map((item) => Number(item.profit_loss || 0)),
            backgroundColor: holdings.map((item) =>
              Number(item.profit_loss) >= 0 ? positive : negative,
            ),
            borderRadius: 6,
            maxBarThickness: 22,
          },
        ],
      },
      options: {
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: {
              color: styles.getPropertyValue("--muted").trim(),
              callback: (value) => money(value),
            },
            grid: { color: styles.getPropertyValue("--border").trim() },
          },
          y: {
            ticks: { color: styles.getPropertyValue("--text").trim() },
            grid: { display: false },
          },
        },
        animation: reducedMotion() ? false : { duration: 700 },
      },
    });
  }

  // Per-row sparklines on Market/Watchlist (§8: "lazily fetch history(id)
  // only for rows scrolled into view, with a small in-memory cache" — the
  // default in the integration guide is to omit these rather than fire a
  // history() request per row on load; this is that lazy alternative).
  //
  // These plot the stock's *actual market* life, not the MockFolio
  // simulated price — i.e. reference_price, the anchor MockFolio's price
  // drifts around (see DESIGN.md). history() only gets a row when a trade
  // or decay tick runs, so a stock nobody has traded yet can have little
  // or no reference-price history; for those, fetchMarketLifeSeries()
  // below fills in a placeholder so every row still gets a chart.
  //
  // TODO(real market data): fetchMarketLifeSeries() is the one place to
  // change when a real market-data API is available. Replace its body
  // with something like:
  //   const res = await fetch(`https://<provider>/v1/quotes/${stock.symbol}/history?range=1mo`);
  //   const data = await res.json();
  //   return data.prices; // closing prices, oldest first
  // and the fallback branch (and its "fabricated" note) can be deleted.
  const sparklineCache = new Map();
  const sparklineCharts = new Map();
  let sparklineObserver;
  function initSparklines() {
    if (typeof Chart === "undefined") return;
    if (sparklineObserver) sparklineObserver.disconnect();
    sparklineObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          sparklineObserver.unobserve(entry.target);
          loadSparkline(entry.target);
        });
      },
      { rootMargin: "200px" },
    );
    $$("canvas.sparkline").forEach((canvas) => {
      const existing = sparklineCharts.get(canvas.dataset.sparkline);
      if (existing) existing.destroy();
      sparklineObserver.observe(canvas);
    });
  }
  // A small deterministic PRNG (mulberry-ish LCG) seeded from the symbol,
  // so the fabricated walk is stable across re-renders/theme toggles
  // instead of jumping around every time it's redrawn.
  function seededRandom(seedText) {
    let state = [...String(seedText)].reduce(
      (sum, ch) => sum + ch.charCodeAt(0),
      7,
    );
    return () => {
      state = (state * 9301 + 49297) % 233280;
      return state / 233280;
    };
  }
  function fabricateMarketSeries(stock, count = 20) {
    const end =
      Number(stock.reference_price) || Number(stock.simulated_price) || 100;
    const next = seededRandom(stock.symbol || stock.id);
    const series = [end];
    let value = end;
    for (let i = 1; i < count; i++) {
      const step = (next() - 0.5) * value * 0.012;
      value = Math.max(value * 0.85, value - step);
      series.push(value);
    }
    return series.reverse();
  }
  async function fetchMarketLifeSeries(stock) {
    try {
      const history = await api.history(stock.id);
      const real = history
        .slice()
        .reverse()
        .map((item) => Number(item.reference_price))
        .filter((value) => Number.isFinite(value));
      if (real.length >= 6) return real;
    } catch {
      // fall through to the placeholder below
    }
    return fabricateMarketSeries(stock);
  }
  async function loadSparkline(canvas) {
    const id = canvas.dataset.sparkline;
    try {
      let points = sparklineCache.get(id);
      if (!points) {
        const stock =
          stocks.find((item) => String(item.id) === id) ||
          watchlist.find((item) => String(item.id) === id);
        if (!stock) return;
        points = await fetchMarketLifeSeries(stock);
        sparklineCache.set(id, points);
      }
      if (points.length < 2 || !canvas.isConnected) return;
      const up = points[points.length - 1] >= points[0];
      const styles = getComputedStyle(document.documentElement);
      const chart = new Chart(canvas, {
        type: "line",
        data: {
          labels: points.map((_, i) => i),
          datasets: [
            {
              data: points,
              borderColor: styles
                .getPropertyValue(up ? "--positive" : "--negative")
                .trim(),
              borderWidth: 1.5,
              pointRadius: 0,
              tension: 0.3,
              fill: false,
            },
          ],
        },
        options: {
          responsive: false,
          animation: false,
          scales: { x: { display: false }, y: { display: false } },
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
        },
      });
      sparklineCharts.set(id, chart);
    } catch {
      // No sparkline for this row is a cosmetic miss, not worth a toast.
    }
  }

  async function loadStock() {
    const id = new URLSearchParams(location.search).get("id");
    try {
      const [stockData, history, watchlistData] = await Promise.all([
        api.stock(id),
        api.history(id),
        api.watchlist(),
      ]);
      let stock = stockData;
      watchlist = watchlistData;
      const starred = watchlist.some((item) => item.id === stock.id);
      const isAdmin = Boolean(currentUser?.is_admin);
      const tradePanel = isAdmin
        ? `<aside class="panel trade-panel read-only-panel"><span class="eyebrow">DEVELOPER ACCOUNT</span><h2>Trading disabled</h2><p class="helper">Developer accounts can inspect the simulated market but cannot place BUY or SELL orders.</p></aside>`
        : `<aside class="panel trade-panel"><div class="panel-heading"><div><span class="eyebrow">SIMULATED ORDER DESK</span><h2>Trade ${escapeHTML(stock.symbol)}</h2></div><span class="paper-mode-pill">${svgIcon(ICONS.lock)} Paper mode</span></div><div class="segmented"><button class="active" data-side="BUY">${svgIcon(ICONS.plusCircle)}Buy</button><button data-side="SELL">${svgIcon(ICONS.minusCircle)}Sell</button></div><label for="quantity">Quantity (shares)</label><div class="quantity-stepper"><button type="button" id="qty-decrease" aria-label="Decrease quantity">−</button><input id="quantity" type="number" min="1" step="1" value="10" inputmode="numeric" /><button type="button" id="qty-increase" aria-label="Increase quantity">+</button></div><div class="estimate"><div><span>Current price</span><strong id="estimate-price">${money(stock.simulated_price)}</strong></div><div><span>Estimated amount</span><strong id="estimate-value">${money(stock.simulated_price * 10)}</strong></div><div><span>Brokerage (0.1%)</span><strong id="estimate-brokerage">${money(stock.simulated_price * 10 * 0.001)}</strong></div><div class="estimate-total"><span>Estimated total</span><strong id="estimate-total">${money(stock.simulated_price * 10 * 1.001)}</strong></div></div><button class="primary-button full" id="trade-button">Buy stock</button><div id="trade-feedback" class="trade-feedback hidden"></div><p class="helper">Your fill price is determined by the server. A trade changes the shared simulated market price.</p></aside>`;
      $("#stock-content").innerHTML =
        `<div class="stock-heading"><div><span class="eyebrow">${escapeHTML(stock.sector)}</span><h1>${escapeHTML(stock.company_name)}</h1><p class="symbol-label">${escapeHTML(stock.symbol)}</p></div><div class="price-block"><div class="price-block-top"><span>MockFolio price</span><button class="table-action${starred ? " is-watched" : ""}" data-watch="${stock.id}" title="${starred ? "Remove from watchlist" : "Add to watchlist"}" aria-pressed="${starred}">${svgIcon(ICONS.watchlist)}</button></div><strong id="stock-price">${money(stock.simulated_price)}</strong><em id="stock-deviation" class="${tone(stock.deviation)}">${signed(stock.deviation)} (${percent(stock.deviation_percentage)})</em><span class="reference-pill" id="stock-reference">Reference ${money(stock.reference_price)}</span></div></div><div class="stock-grid"><section class="panel chart-panel"><div class="panel-heading"><div><span class="eyebrow">PRICE STORY</span><h2>MockFolio price history</h2></div></div><canvas id="price-chart" aria-label="Line chart comparing the MockFolio price and the reference price over recent history" role="img"></canvas><div id="chart-empty" class="empty-state compact hidden">No price history yet. Your first trade will create a point.</div><p class="chart-caption">Solid teal is the MockFolio price; dashed grey is the reference it drifts back toward.</p></section>${tradePanel}</div><section id="trade-result" class="trade-result hidden"></section>`;
      drawChart(history);
      bindWatchButtons();
      if (!isAdmin) bindTrade(stock);
    } catch (error) {
      $("#stock-content").innerHTML =
        `<div class="error-state">${escapeHTML(error.message)}</div>`;
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
        Number(stock.simulated_price) * Number(quantity.value || 0);
      $("#estimate-price").textContent = money(stock.simulated_price);
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
          stock_id: stock.id,
          quantity: amount,
          client_order_key: crypto.randomUUID(),
        });
        const impact = Number(result.price_impact);
        const arrow = impact > 0 ? "↑" : impact < 0 ? "↓" : "–";
        $("#trade-result").className = "trade-result visible";
        $("#trade-result").innerHTML =
          `<span class="success-mark">${svgIcon(ICONS.check)}</span><div><span class="eyebrow">TRADE EXECUTED</span><h2>${side} ${escapeHTML(stock.symbol)}</h2><div class="result-grid"><div><span>Fill price</span><strong>${money(result.fill_price)}</strong></div><div><span>Total cost</span><strong>${money(result.total_cost)}</strong></div><div><span>Brokerage</span><strong>${money(result.brokerage)}</strong></div><div><span>Price impact</span><strong class="${tone(impact)}">${signed(impact)}</strong></div><div><span>New deviation</span><strong class="${tone(result.deviation_after_trade)}">${signed(result.deviation_after_trade)}</strong></div></div><div class="impact-story"><span>Before ${money(result.price_before)}</span><b>${arrow} ${side} IMPACT ${signed(impact)}</b><span>After ${money(result.price_after)}</span></div></div>`;
        toast("Trade executed successfully", "success");
        const previousPrice = Number(stock.simulated_price);
        stock = await api.stock(stock.id);
        updateEstimate();
        const priceEl = $("#stock-price");
        if (priceEl) {
          tweenNumber(
            priceEl,
            previousPrice,
            Number(stock.simulated_price),
            money,
          );
          const flashClass =
            Number(stock.simulated_price) >= previousPrice
              ? "price-flash-up"
              : "price-flash-down";
          priceEl.classList.remove("price-flash-up", "price-flash-down");
          void priceEl.offsetWidth;
          priceEl.classList.add(flashClass);
          setTimeout(() => priceEl.classList.remove(flashClass), 650);
        }
        const deviationEl = $("#stock-deviation");
        if (deviationEl) {
          deviationEl.className = tone(stock.deviation);
          deviationEl.textContent = `${signed(stock.deviation)} (${percent(stock.deviation_percentage)})`;
        }
        const referenceEl = $("#stock-reference");
        if (referenceEl)
          referenceEl.textContent = `Reference ${money(stock.reference_price)}`;
        if (priceChart) {
          priceChart.data.labels.push(
            new Date().toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            }),
          );
          priceChart.data.datasets[0].data.push(stock.simulated_price);
          priceChart.data.datasets[1].data.push(stock.reference_price);
          priceChart.update();
        }
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
                  `<tr><td data-label="Username"><a class="user-name-link" href="developer-user.html?id=${item.id}">${escapeHTML(item.username)}</a>${item.is_admin ? '<span class="badge admin">ADMIN</span>' : ""}</td><td data-label="Email">${escapeHTML(item.email)}</td><td data-label="Joined">${new Date(item.created_at).toLocaleDateString("en-IN")}</td><td data-label="Cash balance">${money(item.cash_balance)}</td><td data-label="Portfolio">${money(item.portfolio_value)}</td><td data-label="P&L" class="${tone(item.total_pnl)}">${signed(item.total_pnl)}</td><td data-label="Trades">${item.trade_count}</td></tr>`,
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
                `<tr><td data-label="Stock"><strong>${escapeHTML(item.symbol)}</strong><small>${escapeHTML(item.company_name)}</small></td><td data-label="Quantity">${item.quantity}</td><td data-label="Average buy">${money(item.average_buy_price)}</td><td data-label="Current price">${money(item.simulated_price)}</td><td data-label="P&L" class="${tone(item.profit_loss)}">${signed(item.profit_loss)}</td></tr>`,
            )
            .join("")
        : '<tr><td colspan="5"><div class="empty-state"><strong>No current holdings.</strong></div></td></tr>';
      const tradeRows = trades.length
        ? trades
            .map(
              (item) =>
                `<tr><td data-label="Date">${new Date(item.created_at).toLocaleString("en-IN")}</td><td data-label="Stock">${escapeHTML(item.symbol)}</td><td data-label="Side"><span class="badge ${item.side.toLowerCase()}">${item.side}</span></td><td data-label="Quantity">${item.quantity}</td><td data-label="Fill price">${money(item.fill_price)}</td><td data-label="Brokerage">${money(item.brokerage)}</td><td data-label="Impact" class="${tone(item.price_impact)}">${signed(item.price_impact)}</td><td data-label="Before">${money(item.price_before)}</td><td data-label="After">${money(item.price_after)}</td></tr>`,
            )
            .join("")
        : '<tr><td colspan="9"><div class="empty-state"><strong>This user has not made any trades yet.</strong></div></td></tr>';
      const orderRows = orders.length
        ? orders
            .map(
              (item) =>
                `<tr><td data-label="Date">${new Date(item.created_at).toLocaleString("en-IN")}</td><td data-label="Stock">${escapeHTML(item.symbol)}</td><td data-label="Type"><span class="badge ${item.order_type.toLowerCase()}">${item.order_type}</span></td><td data-label="Quantity">${item.quantity}</td><td data-label="Requested price">${money(item.requested_price)}</td><td data-label="Status"><span class="badge filled">${item.status}</span></td></tr>`,
            )
            .join("")
        : '<tr><td colspan="6"><div class="empty-state"><strong>No orders yet.</strong></div></td></tr>';
      const accountStats = [
        adminSummaryCard("Cash balance", money(account.cash_balance)),
        adminSummaryCard("Portfolio value", money(account.portfolio_value)),
        adminSummaryCard("Total account value", money(account.total_account_value)),
        adminSummaryCard(
          "Total P&L",
          signed(account.total_pnl),
          undefined,
          tone(account.total_pnl),
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
