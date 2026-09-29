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
  let refreshDesk;
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
  // The API sends naive UTC timestamps; without a zone the browser would read them as local time.
  const utcDate = (value) => new Date(/Z|[+-]\d\d:?\d\d$/.test(String(value)) ? value : `${value}Z`);
  const stamp = (value) =>
    utcDate(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  // price_impact is a fraction of price (0.0056 = 0.56%), not rupees.
  const impactPct = (value) => `${Number(value || 0) >= 0 ? "+" : ""}${(Number(value || 0) * 100).toFixed(2)}%`;
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
    user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
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
    const header = `<header class="topbar"><a class="brand" href="index.html"><span class="brand-mark">M</span><span>mockfolio</span></a><nav class="desktop-nav"><a class="${active("market")}" href="index.html">Market</a><a class="${active("watchlist")}" href="watchlist.html">Watchlist</a><a class="${active("portfolio")}" href="portfolio.html">Portfolio</a><a class="${active("orders")}" href="orders.html">Orders</a><a class="${active("news")}" href="news.html">News</a><a class="${active("economy")}" href="economy.html">Economy</a>${developerLink}</nav><div class="top-actions"><div class="account-menu"><button class="nav-avatar" id="account-button" aria-haspopup="menu" aria-expanded="false" aria-controls="account-dropdown" title="Account menu">${avatarInitial}</button><div class="account-dropdown" id="account-dropdown" role="menu" hidden><div class="account-dropdown-head"><span class="nav-avatar static" aria-hidden="true">${avatarInitial}</span><div><strong>${escapeHTML(user.username)}</strong><small>${escapeHTML(user.email || "")}</small></div></div><a role="menuitem" href="portfolio.html">${svgIcon(ICONS.portfolio)}Portfolio</a><a role="menuitem" href="profile.html">${svgIcon(ICONS.user)}Account info</a><a role="menuitem" href="settings.html">${svgIcon(ICONS.settings)}Settings</a><a role="menuitem" class="menu-mobile-only" href="news.html">${svgIcon(ICONS.orders)}News</a><a role="menuitem" class="menu-mobile-only" href="economy.html">${svgIcon(ICONS.market)}Economic calendar</a><button role="menuitemcheckbox" class="theme-toggle" id="theme-toggle" aria-checked="false">${svgIcon(ICONS.moon, "icon-moon")}${svgIcon(ICONS.sun, "icon-sun")}<span id="theme-toggle-label">Dark mode</span><i class="switch" aria-hidden="true"></i></button><button role="menuitem" class="danger-item" id="logout">${svgIcon(ICONS.logout)}Log out</button></div></div></div></header>`;
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
    const menuButton = $("#account-button");
    const menu = $("#account-dropdown");
    const setMenu = (open) => {
      menu.hidden = !open;
      menuButton.setAttribute("aria-expanded", String(open));
    };
    menuButton.onclick = (event) => {
      event.stopPropagation();
      setMenu(menu.hidden);
    };
    menu.onclick = (event) => event.stopPropagation();
    document.addEventListener("click", () => setMenu(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !menu.hidden) {
        setMenu(false);
        menuButton.focus();
      }
    });
    updateThemeToggle();
  }

  function updateThemeToggle() {
    const dark = window.MockfolioTheme.current() === "dark";
    const toggle = $("#theme-toggle");
    if (toggle) toggle.setAttribute("aria-checked", String(dark));
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
            if (watchlist.some((item) => item.instrument_id === id)) {
              await api.removeWatchlist(id);
              watchlist = watchlist.filter((item) => item.instrument_id !== id);
              toast("Removed from watchlist");
            } else {
              await api.addWatchlist(id);
              watchlist.push(stocks.find((item) => item.instrument_id === id) || { instrument_id: id });
              toast("Added to watchlist", "success");
            }
            if (page === "watchlist") await loadWatchlist();
            else {
              // Any other page with a star button (e.g. the stock detail
              // page): just update this button, no list to re-render.
              const nowStarred = watchlist.some((item) => item.instrument_id === id);
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

  function moversCard(key, title, list, value) {
    const active = key === moverView;
    return `<div class="panel mover-card${active ? " active" : ""}" id="mover-${key}" role="tabpanel" data-mover-card="${key}"><span class="eyebrow">${title}</span><ol>${list
      .map(
        (s) => `<li><a href="stock.html?id=${s.instrument_id}"><strong>${escapeHTML(s.symbol)}</strong><span>${money(s.adjusted_price)}</span><em class="${tone(value(s))}">${percent(value(s))}</em></a></li>`,
      )
      .join("")}</ol></div>`;
  }

  // Desktop shows the three mover cards side by side; phones show one at a time behind these tabs.
  const MOVER_TABS = [
    { key: "gainers", label: "Top gainers" },
    { key: "losers", label: "Top losers" },
    { key: "gap", label: "Off real price" },
  ];
  let moverView = "gainers";

  function renderMovers() {
    const host = $("#movers");
    if (!host || !stocks.length) return;
    const by = (fn, dir) => [...stocks].sort((a, b) => dir * (fn(a) - fn(b))).slice(0, 3);
    const change = (s) => Number(s.day_change_percentage);
    const gap = (s) => Number(s.deviation_percentage);
    const tabs = MOVER_TABS.map(
      (t) => `<button type="button" role="tab" data-mover-tab="${t.key}" aria-controls="mover-${t.key}" aria-selected="${t.key === moverView}" class="${t.key === moverView ? "active" : ""}">${t.label}</button>`,
    ).join("");
    host.innerHTML =
      `<div class="chart-tabs mover-tabs" role="tablist" aria-label="Market movers">${tabs}</div>` +
      moversCard("gainers", "TOP GAINERS TODAY", by(change, -1), change) +
      moversCard("losers", "TOP LOSERS TODAY", by(change, 1), change) +
      moversCard("gap", "FURTHEST FROM REAL PRICE", by((s) => Math.abs(gap(s)), -1), gap);
    $$("[data-mover-tab]").forEach(
      (button) =>
        (button.onclick = () => {
          moverView = button.dataset.moverTab;
          $$("[data-mover-tab]").forEach((b) => {
            b.classList.toggle("active", b === button);
            b.setAttribute("aria-selected", String(b === button));
          });
          $$("[data-mover-card]").forEach((card) => card.classList.toggle("active", card.dataset.moverCard === moverView));
        }),
    );
  }

  const TV = window.MockfolioTV;
  const tvSymbol = (stock) => TV?.symbol(stock) || `BSE:${stock.symbol}`;

  // Real prices straight from TradingView. Clicking a symbol opens its MockFolio page (largeChartUrl).
  function renderTickerTape() {
    const host = $("#ticker-tape");
    if (!host || !stocks.length || !TV) return;
    TV.embed(host.querySelector(".ticker-tape-widget"), "ticker-tape", (colorTheme) => ({
      symbols: [
        { proName: "BSE:SENSEX", title: "SENSEX" },
        ...stocks.filter((s) => s.is_core).map((s) => ({ proName: tvSymbol(s), title: s.symbol })),
      ],
      showSymbolLogo: true,
      isTransparent: true,
      displayMode: "adaptive",
      colorTheme,
      locale: "en",
      largeChartUrl: TV.chartUrl(),
    }));
  }

  // The whole Indian market from TradingView, as a second tab next to MockFolio's own screener.
  function initScreenerTabs() {
    let mounted = false;
    $$("[data-screener-tab]").forEach(
      (button) =>
        (button.onclick = () => {
          const real = button.dataset.screenerTab === "real";
          $$("[data-screener-tab]").forEach((b) => {
            b.classList.toggle("active", b === button);
            b.setAttribute("aria-selected", String(b === button));
          });
          $("#mockfolio-screener").hidden = real;
          $("#tv-screener").hidden = !real;
          if (real && !mounted && TV) {
            mounted = true;
            TV.embed($("#tv-screener"), "screener", (colorTheme) => ({
              width: "100%",
              height: "100%",
              defaultColumn: "overview",
              defaultScreen: "most_capitalized",
              market: "india",
              showToolbar: true,
              colorTheme,
              isTransparent: true,
              locale: "en",
              largeChartUrl: TV.chartUrl(),
            }));
          }
        }),
    );
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
      renderTickerTape();
      initScreenerTabs();
      let sortKey = "symbol";
      let sortDir = 1;
      let sector = "All";
      let pageIndex = 0;
      const PAGE_SIZE = 50;
      const sectors = ["All", ...new Set(stocks.map((s) => s.sector).filter(Boolean))].sort((a, b) =>
        a === "All" ? -1 : b === "All" ? 1 : a.localeCompare(b),
      );
      $("#sector-filter").innerHTML = sectors
        .map((name) => `<option value="${escapeHTML(name)}">${name === "All" ? "All sectors" : escapeHTML(name)}</option>`)
        .join("");

      const render = (animate) => {
        const query = $("#stock-search").value.trim().toLowerCase();
        const watchIds = new Set(watchlist.map((item) => item.instrument_id));
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
        const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        pageIndex = Math.min(pageIndex, pages - 1);
        const first = pageIndex * PAGE_SIZE;
        const shown = filtered.slice(first, first + PAGE_SIZE);
        $("#screener-pager").innerHTML = filtered.length > PAGE_SIZE
          ? `<span>${first + 1}–${first + shown.length} of ${filtered.length}</span><button type="button" class="ghost-button" data-page-step="-1" ${pageIndex === 0 ? "disabled" : ""}>← Previous</button><button type="button" class="ghost-button" data-page-step="1" ${pageIndex >= pages - 1 ? "disabled" : ""}>Next →</button>`
          : "";
        $$("[data-page-step]").forEach(
          (button) =>
            (button.onclick = () => {
              pageIndex += Number(button.dataset.pageStep);
              render(false);
              $("#mockfolio-screener").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" });
            }),
        );
        $("#market-table").innerHTML = shown.length
          ? shown.map((stock) => screenerRow(stock, watchIds.has(stock.instrument_id))).join("")
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
      $("#market-status-detail").textContent = `NIFTY 500 · ${stocks.length} stocks · updates every 10s`;
      const refilter = () => {
        pageIndex = 0;
        render(false);
      };
      $("#stock-search").oninput = refilter;
      $("#market-filter").onchange = refilter;
      $("#sector-filter").onchange = (event) => {
        sector = event.target.value;
        refilter();
      };
      $$("[data-sort] button").forEach(
        (button) =>
          (button.onclick = () => {
            const next = button.parentElement.dataset.sort;
            // Numbers start high-to-low, names A-Z; a second click flips it.
            sortDir = next === sortKey ? -sortDir : next === "symbol" ? 1 : -1;
            sortKey = next;
            pageIndex = 0;
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

  let valueChart;
  let portfolioPoll;
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
      if (!valueChart || !host.contains(valueChart.element)) {
        host.innerHTML = "";
        valueChart = window.MockfolioCharts.createValueChart(host, { baseline: start });
      }
      valueChart.setData(points);
    } catch (error) {
      host.innerHTML = `<div class="error-state">${escapeHTML(error.message)}</div>`;
    }
  }

  async function loadPortfolio(live = false) {
    if (!live) loading("#portfolio-table", "Loading portfolio...");
    try {
      const [summary, holdings] = await Promise.all([
        api.summary(),
        api.portfolio(),
      ]);
      renderStats(summaryStats(summary, holdings.length));
      const chartsHost = $("#portfolio-charts");
      if (chartsHost) {
        if (!live) chartsHost.innerHTML = valueChartCard();
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
      if (live) return;
      staggerRows("#portfolio-table");
      // Prices tick and pending orders fill in the background, so keep the page current.
      clearInterval(portfolioPoll);
      portfolioPoll = setInterval(() => document.hidden || loadPortfolio(true), 10000);
    } catch (error) {
      $("#portfolio-table").innerHTML =
        `<tr><td colspan="7"><div class="error-state">${escapeHTML(error.message)}</div></td></tr>`;
    }
  }

  function orderTypeLabel(order) {
    if (order.parent_order_id) return order.order_type === "STOPLOSS" ? "Stop-loss exit" : "Target exit";
    return { MARKET: "Market", LIMIT: "Limit", STOPLOSS: "Stop" }[order.order_type] || order.order_type;
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
                `<tr><td data-label="Date">${stamp(item.created_at)}</td><td data-label="Stock"><a href="stock.html?id=${item.instrument_id}"><strong>${escapeHTML(item.symbol)}</strong></a></td><td data-label="Side"><span class="badge ${item.side.toLowerCase()}">${item.side}</span></td><td data-label="Type">${orderTypeLabel(item)}</td><td data-label="Quantity">${item.quantity}</td><td data-label="Price">${item.limit_price ? money(item.limit_price) : item.trigger_price ? `trigger ${money(item.trigger_price)}` : "Market"}</td><td data-label="Stop-loss / Target">${item.stop_loss || item.target_price ? `${item.stop_loss ? money(item.stop_loss) : "—"} / ${item.target_price ? money(item.target_price) : "—"}` : "—"}</td><td data-label="Status"><span class="badge status-${item.status.toLowerCase()}" title="${escapeHTML(item.reject_reason || "")}">${item.status}</span>${item.reject_reason ? `<small>${escapeHTML(item.reject_reason)}</small>` : ""}</td><td data-label="">${item.status === "PENDING" ? `<button type="button" class="ghost-button" data-cancel-order="${item.order_id}">Cancel</button>` : ""}</td></tr>`,
            )
            .join("")
        : `<tr><td colspan="9"><div class="empty-state"><strong>No orders yet</strong><span>Your orders will appear here.</span></div></td></tr>`;
      $$("[data-cancel-order]").forEach(
        (button) =>
          (button.onclick = async () => {
            button.disabled = true;
            try {
              await api.cancelOrder(button.dataset.cancelOrder);
              toast("Order cancelled");
              await loadOrders();
            } catch (error) {
              toast(error.message, "error");
              button.disabled = false;
            }
          }),
      );
      $("#trades-table").innerHTML = trades.length
        ? trades
            .map(
              (item) =>
                `<tr><td data-label="Date">${stamp(item.executed_at)}</td><td data-label="Stock"><strong>${escapeHTML(item.symbol)}</strong></td><td data-label="Side"><span class="badge ${item.side.toLowerCase()}">${item.side}</span></td><td data-label="Quantity">${item.quantity}</td><td data-label="Fill price">${money(item.exec_price)}</td><td data-label="Brokerage">${money(item.brokerage)}</td><td data-label="Price impact" class="${tone(item.price_impact)}">${impactPct(item.price_impact)}</td></tr>`,
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
      TV?.embed($("#tv-watchlist"), "market-quotes", (colorTheme) => ({
        width: "100%",
        height: "100%",
        symbolsGroups: [
          {
            name: "Your watchlist",
            symbols: watchlist.map((stock) => ({ name: tvSymbol(stock), displayName: stock.symbol })),
          },
        ],
        showSymbolLogo: true,
        isTransparent: true,
        colorTheme,
        locale: "en",
        largeChartUrl: TV.chartUrl(),
      }));
      $("#tv-watchlist-section")?.removeAttribute("hidden");
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
        `<section class="profile-hero"><div><span class="eyebrow">PROFILE / ACCOUNT</span><h1>Hi, ${escapeHTML(user.name || user.username)}</h1><p>Your paper-trading account.</p></div>${user.is_admin ? '<span class="account-status"><strong>Developer Account</strong><small>Trading disabled</small></span>' : ""}</section><section class="portfolio-summary panel"><span class="eyebrow">PORTFOLIO</span><strong class="portfolio-total">${money(summary.total_account_value)}</strong><span class="summary-label">Total account value</span><div class="summary-metrics"><div><span>Invested</span><strong>${money(invested)}</strong></div><div><span>Current value</span><strong>${money(summary.holdings_value)}</strong></div><div><span>P&L</span><strong class="${tone(summary.unrealised_pnl)}">${signed(summary.unrealised_pnl)} <small>(${percent(pnlPercent)})</small></strong></div></div></section><section class="profile-metrics"><div><span>Available cash</span><strong>${money(summary.cash_balance)}</strong></div><div><span>Invested value</span><strong>${money(invested)}</strong></div><div><span>Current value</span><strong>${money(summary.holdings_value)}</strong></div><div><span>Total P&L</span><strong class="${tone(summary.unrealised_pnl)}">${signed(summary.unrealised_pnl)}</strong></div></section><section class="profile-section">${valueChartCard()}</section><section class="profile-section"><div class="section-heading"><div><span class="eyebrow">YOUR BOOK</span><h2>Your holdings</h2></div></div><div class="table-wrap"><table><thead><tr><th>Stock</th><th>Qty</th><th>Avg. price</th><th>Simulated price</th><th>Current value</th><th>P&L</th></tr></thead><tbody>${holdings.length ? holdings.map((item) => `<tr><td data-label="Stock"><a class="stock-name" href="stock.html?id=${item.instrument_id}"><strong>${escapeHTML(item.symbol)}</strong><small>${escapeHTML(item.company_name || "")}</small></a></td><td data-label="Qty">${Number(item.quantity).toLocaleString("en-IN")}</td><td data-label="Avg. price">${money(item.avg_price)}</td><td data-label="Simulated price">${money(item.adjusted_price)}</td><td data-label="Current value">${money(item.market_value)}</td><td data-label="P&L" class="${tone(item.unrealised_pnl)}"><strong>${signed(item.unrealised_pnl)}</strong></td></tr>`).join("") : '<tr><td colspan="6"><div class="empty-state"><strong>Your portfolio is empty</strong><span>Start paper trading to build your portfolio.</span><a class="primary-button" href="index.html">Browse stocks</a></div></td></tr>'}</tbody></table></div></section><section class="profile-section"><div class="section-heading"><div><span class="eyebrow">ACTIVITY</span><h2>Recent activity</h2></div></div><div class="table-wrap"><table><thead><tr><th>Side</th><th>Stock</th><th>Quantity</th><th>Fill price</th><th>Price impact</th><th>Date</th></tr></thead><tbody>${activity.length ? activity.map((item) => `<tr><td data-label="Side"><span class="badge ${item.side.toLowerCase()}">${item.side}</span></td><td data-label="Stock"><strong>${escapeHTML(item.symbol)}</strong></td><td data-label="Quantity">${item.quantity}</td><td data-label="Fill price">${money(item.exec_price)}</td><td data-label="Price impact" class="${tone(item.price_impact)}">${impactPct(item.price_impact)}</td><td data-label="Date">${utcDate(item.executed_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td></tr>`).join("") : '<tr><td colspan="6"><div class="empty-state"><strong>No recent activity</strong></div></td></tr>'}</tbody></table></div></section><section class="profile-section account-section"><div class="section-heading"><div><span class="eyebrow">ACCOUNT</span><h2>Account information</h2></div></div><div class="account-grid panel">${profileRow("Username", escapeHTML(user.username))}${profileRow("Email", escapeHTML(user.email))}${profileRow("Account type", user.is_admin ? "Developer · Trading disabled" : "Standard user")}${profileRow("Member since", utcDate(user.created_at).toLocaleDateString("en-IN"))}</div></section>`;
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

  // Real-market chart ranges. TradingView widgets take a range plus a bar interval.
  const RANGES = [
    { label: "1D", range: "1D", interval: "1" },
    { label: "1W", range: "5D", interval: "5" },
    { label: "1M", range: "1M", interval: "30" },
    { label: "6M", range: "6M", interval: "D" },
    { label: "1Y", range: "12M", interval: "D" },
    { label: "5Y", range: "60M", interval: "W" },
  ];
  const MORE_RANGES = [
    { label: "3M", range: "3M", interval: "60" },
    { label: "YTD", range: "YTD", interval: "D" },
    { label: "All", range: "ALL", interval: "M" },
  ];

  function rangeToolbar() {
    const button = (r, i) =>
      `<button type="button" data-range="${r.label}" class="${r.label === "1Y" ? "active" : ""}" aria-pressed="${r.label === "1Y"}">${r.label}</button>`;
    return `<div class="tv-toolbar"><div class="tv-group" role="group" aria-label="Date range">${RANGES.map(button).join("")}</div><div class="range-more"><button type="button" class="range-more-toggle" id="range-more-toggle" aria-haspopup="true" aria-expanded="false">More ▾</button><div class="range-more-menu" id="range-more-menu" hidden>${MORE_RANGES.map(button).join("")}</div></div><span class="tv-toolbar-note">Real BSE prices · drawing tools and indicators on the left</span></div>`;
  }

  function realMarketSections(title) {
    return `<section class="real-market-grid wide-first"><div class="panel tv-widget-panel"><span class="eyebrow">FUNDAMENTALS · ${escapeHTML(title)}</span><div class="tv-financials" id="tv-financials"></div></div><div class="panel tv-widget-panel"><span class="eyebrow">COMPANY PROFILE</span><div class="tv-profile" id="tv-profile"></div></div></section><section class="real-market-grid"><div class="panel tv-widget-panel"><span class="eyebrow">REAL MARKET SNAPSHOT</span><div class="tv-symbol-info" id="tv-symbol-info"></div></div><div class="panel tv-widget-panel"><span class="eyebrow">TECHNICAL RATING · ${escapeHTML(title)}</span><div class="tv-stock-news" id="tv-technicals"></div></div></section>`;
  }

  // Advanced Real-Time Chart, symbol snapshot and news for one TradingView symbol.
  function mountRealMarket(symbol) {
    if (!TV) return;
    let current = RANGES.find((r) => r.label === "1Y");
    const drawChart = () =>
      TV.embed($("#tv-advanced"), "advanced-chart", (theme) => ({
        autosize: true,
        symbol,
        interval: current.interval,
        range: current.range,
        timezone: "Asia/Kolkata",
        theme,
        style: "1",
        locale: "en",
        allow_symbol_change: false,
        // On phones the drawing toolbar eats a big slice of the chart width.
        hide_side_toolbar: window.matchMedia("(max-width: 620px)").matches,
        withdateranges: false,
        save_image: true,
        calendar: false,
        details: false,
        support_host: "https://www.tradingview.com",
      }));
    drawChart();
    $$("[data-range]").forEach(
      (button) =>
        (button.onclick = () => {
          current = [...RANGES, ...MORE_RANGES].find((r) => r.label === button.dataset.range);
          $$("[data-range]").forEach((b) => {
            b.classList.toggle("active", b === button);
            b.setAttribute("aria-pressed", String(b === button));
          });
          const inMore = MORE_RANGES.includes(current);
          $("#range-more-toggle").classList.toggle("active", inMore);
          $("#range-more-toggle").textContent = `${inMore ? current.label : "More"} ▾`;
          $("#range-more-menu").hidden = true;
          drawChart();
        }),
    );
    const toggle = $("#range-more-toggle");
    toggle.onclick = (event) => {
      event.stopPropagation();
      const open = $("#range-more-menu").hidden;
      $("#range-more-menu").hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    };
    document.addEventListener("click", () => {
      $("#range-more-menu") && ($("#range-more-menu").hidden = true);
      toggle.setAttribute("aria-expanded", "false");
    });
    TV.embed($("#tv-symbol-info"), "symbol-info", (colorTheme) => ({
      symbol,
      width: "100%",
      locale: "en",
      colorTheme,
      isTransparent: true,
    }));
    TV.embed($("#tv-financials"), "financials", (colorTheme) => ({
      isTransparent: true,
      largeChartUrl: "",
      displayMode: "regular",
      width: "100%",
      height: "100%",
      colorTheme,
      symbol,
      locale: "en",
    }));
    TV.embed($("#tv-profile"), "symbol-profile", (colorTheme) => ({
      width: "100%",
      height: "100%",
      isTransparent: true,
      colorTheme,
      symbol,
      locale: "en",
    }));
    // TradingView's news widget has no stories for Indian stocks, so the per-stock panel is its technical rating.
    TV.embed($("#tv-technicals"), "technical-analysis", (colorTheme) => ({
      interval: "1D",
      width: "100%",
      height: "100%",
      isTransparent: true,
      symbol,
      showIntervalTabs: true,
      displayMode: "single",
      locale: "en",
      colorTheme,
    }));
  }

  // A symbol clicked in a TradingView widget that MockFolio doesn't list: show it, but it can't be traded here.
  function renderRealOnly(symbol) {
    const name = symbol.split(":").pop();
    $("#stock-content").innerHTML = `<header class="tv-header"><div class="tv-symbol"><span class="tv-avatar" aria-hidden="true">${escapeHTML(name[0] || "?")}</span><div><h1>${escapeHTML(name)} <span class="tv-exchange">${escapeHTML(symbol.split(":")[0])}</span></h1><p>Real market view · not tradable on MockFolio</p></div></div></header><div class="settings-note">${svgIcon(ICONS.lock)}<span>MockFolio simulates 30 NIFTY stocks. ${escapeHTML(name)} isn't one of them, so you can research it here but not trade it. <a href="index.html">Browse tradable stocks</a></span></div><section class="panel tv-chart-panel"><div id="real-pane">${rangeToolbar()}<div class="tv-advanced" id="tv-advanced"></div></div></section>${realMarketSections(name)}`;
    mountRealMarket(symbol);
  }

  async function loadStock() {
    const params = new URLSearchParams(location.search);
    let id = params.get("id");
    if (!id && params.get("tvwidgetsymbol")) {
      // Arrived from a TradingView widget click: map "NSE:RELIANCE" back to our instrument.
      const wanted = params.get("tvwidgetsymbol").toUpperCase();
      const match = (await api.stocks()).find((s) => tvSymbol(s) === wanted || s.symbol === wanted.split(":").pop());
      if (!match) {
        renderRealOnly(wanted);
        return;
      }
      id = String(match.instrument_id);
      history.replaceState(null, "", `stock.html?id=${id}`);
    }
    try {
      const [stockData, watchlistData] = await Promise.all([api.stock(id), api.watchlist()]);
      let stock = stockData;
      watchlist = watchlistData;
      const starred = watchlist.some((item) => item.instrument_id === stock.instrument_id);
      const isAdmin = Boolean(currentUser?.is_admin);
      const tradePanel = isAdmin
        ? `<aside class="panel trade-panel read-only-panel"><span class="eyebrow">DEVELOPER ACCOUNT</span><h2>Trading disabled</h2><p class="helper">Developer accounts can inspect the simulated market but cannot place BUY or SELL orders.</p></aside>`
        : orderDeskHTML(stock);
      const intervalButtons = INTERVALS.map(
        (item, i) => `<button type="button" data-interval="${item.minutes}" class="${i === 0 ? "active" : ""}" aria-pressed="${i === 0}">${item.label}</button>`,
      ).join("");
      $("#stock-content").innerHTML =
        `<header class="tv-header"><div class="tv-symbol"><span class="tv-avatar" aria-hidden="true">${escapeHTML(stock.symbol[0])}</span><div><h1>${escapeHTML(stock.symbol)} <span class="tv-exchange">${escapeHTML(stock.exchange || "NSE")}</span></h1><p>${escapeHTML(stock.company_name)} · ${escapeHTML(stock.sector || "")}</p></div><button class="table-action${starred ? " is-watched" : ""}" data-watch="${stock.instrument_id}" title="${starred ? "Remove from watchlist" : "Add to watchlist"}" aria-pressed="${starred}">${svgIcon(ICONS.watchlist)}</button></div><div class="tv-quote"><strong id="stock-price">${money(stock.adjusted_price)}</strong><em id="stock-change"></em><span class="tv-quote-label">MockFolio price · <span class="tv-live-dot"></span> live</span></div><div class="tv-stats" id="tv-stats"></div></header>` +
        `<div class="stock-grid"><section class="panel tv-chart-panel"><div class="chart-tabs" role="tablist" aria-label="Chart"><button type="button" role="tab" class="active" aria-selected="true" data-chart-tab="real">Real market · TradingView</button><button type="button" role="tab" aria-selected="false" data-chart-tab="mockfolio">MockFolio price</button></div><div id="real-pane">${rangeToolbar()}<div class="tv-advanced" id="tv-advanced"></div></div><div id="mockfolio-pane" hidden><div class="tv-toolbar"><div class="tv-group" role="group" aria-label="Interval">${intervalButtons}</div><span class="tv-divider"></span><div class="tv-group" role="group" aria-label="Chart type"><button type="button" data-chart-view="candles" class="active" aria-pressed="true">${svgIcon(ICONS.candles)}Candles</button><button type="button" data-chart-view="line" aria-pressed="false">${svgIcon(ICONS.lines)}MockFolio vs Real</button></div></div><div class="tv-chart-wrap"><div id="tv-chart" role="img" aria-label="Price chart for ${escapeHTML(stock.symbol)}"></div><div class="tv-legend" id="tv-legend"></div><div id="chart-empty" class="tv-empty hidden">No price history yet. Candles appear as the market ticks.</div></div><p class="chart-caption" id="chart-caption">${CHART_CAPTIONS.candles}</p></div></section>${tradePanel}</div><section id="trade-result" class="trade-result hidden"></section>${realMarketSections(stock.symbol)}`;
      renderQuote(stock);
      mountRealMarket(tvSymbol(stock));
      $$("[data-chart-tab]").forEach(
        (button) =>
          (button.onclick = () => {
            const real = button.dataset.chartTab === "real";
            $$("[data-chart-tab]").forEach((b) => {
              b.classList.toggle("active", b === button);
              b.setAttribute("aria-selected", String(b === button));
            });
            $("#real-pane").hidden = !real;
            $("#mockfolio-pane").hidden = real;
          }),
      );

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
          Object.assign(stock, fresh);
          $("#stock-price").textContent = money(stock.adjusted_price);
          refreshDesk?.();
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

  function orderDeskHTML(stock) {
    const field = (id, label, hint) =>
      `<div class="desk-field" id="${id}-wrap"><label for="${id}">${label}</label><div class="price-input"><span>₹</span><input id="${id}" type="number" min="0.05" step="0.05" inputmode="decimal" /></div>${hint ? `<small id="${id}-hint">${hint}</small>` : ""}</div>`;
    return `<aside class="panel trade-panel order-desk" data-side="BUY"><div class="panel-heading"><div><span class="eyebrow">ORDER DESK</span><h2>${escapeHTML(stock.symbol)}</h2></div><span class="paper-mode-pill">${svgIcon(ICONS.lock)} Paper mode</span></div>
      <div class="segmented side-switch"><button class="active" data-side="BUY">${svgIcon(ICONS.plusCircle)}Buy</button><button data-side="SELL">${svgIcon(ICONS.minusCircle)}Sell</button></div>
      <div class="order-types" role="radiogroup" aria-label="Order type"><button type="button" role="radio" aria-checked="true" class="active" data-type="MARKET">Market</button><button type="button" role="radio" aria-checked="false" data-type="LIMIT">Limit</button><button type="button" role="radio" aria-checked="false" data-type="STOPLOSS">Stop</button></div>
      <div class="desk-row"><div class="desk-field"><label for="quantity">Quantity</label><div class="quantity-stepper"><button type="button" id="qty-decrease" aria-label="Decrease quantity">−</button><input id="quantity" type="number" min="1" step="1" value="10" inputmode="numeric" /><button type="button" id="qty-increase" aria-label="Increase quantity">+</button></div><small id="holding-hint"></small></div></div>
      ${field("limit-price", "Limit price", "Fills at this price or better.")}
      ${field("trigger-price", "Trigger price", "Becomes a market order once the price reaches this.")}
      <div class="bracket" id="bracket"><label class="check"><input type="checkbox" id="use-sl" /> Stop-loss</label>${field("stop-loss", "Exit if price falls to", "")}<label class="check"><input type="checkbox" id="use-target" /> Target</label>${field("target-price", "Take profit at", "")}<div class="rr" id="risk-reward"></div></div>
      <div class="estimate"><div><span id="estimate-price-label">Market price</span><strong id="estimate-price">${money(stock.adjusted_price)}</strong></div><div><span>Order value</span><strong id="estimate-value"></strong></div><div><span id="estimate-brokerage-label">Brokerage</span><strong id="estimate-brokerage"></strong></div><div class="estimate-total"><span>Total</span><strong id="estimate-total"></strong></div><div><span id="funds-label">Available cash</span><strong id="funds"></strong></div></div>
      <button class="primary-button full" id="trade-button">Buy ${escapeHTML(stock.symbol)}</button>
      <div id="trade-feedback" class="trade-feedback hidden"></div>
      <p class="helper" id="desk-helper">Market orders fill now at the MockFolio price, which your own order nudges. Limit and stop orders wait and are checked every tick.</p>
      <div class="open-orders" id="open-orders"></div>
    </aside>`;
  }

  async function bindTrade(stock) {
    let side = "BUY";
    let type = "MARKET";
    let cash = 0;
    let held = 0;
    let brokeragePct = 0.0003;
    const quantity = $("#quantity");
    const num = (id) => Number($(id).value) || 0;
    const desk = $(".order-desk");
    const qty = () => Math.max(1, Math.round(Number(quantity.value) || 1));

    const loadAccount = async () => {
      const [summary, holdings, settings] = await Promise.all([api.summary(), api.portfolio(), api.settings().catch(() => [])]);
      cash = Number(summary.cash_balance);
      held = Number(holdings.find((h) => h.instrument_id === stock.instrument_id)?.quantity || 0);
      const b = settings.find?.((item) => item.key === "brokerage_pct");
      if (b) brokeragePct = Number(b.value);
      $("#estimate-brokerage-label").textContent = `Brokerage (${(brokeragePct * 100).toFixed(2)}%)`;
      update();
    };

    // The price this order is expected to execute at, used for the estimate and the stop/target checks.
    const entry = () => (type === "LIMIT" ? num("#limit-price") : type === "STOPLOSS" ? num("#trigger-price") : Number(stock.adjusted_price));

    function update() {
      desk.dataset.side = side;
      $("#limit-price-wrap").hidden = type !== "LIMIT";
      $("#trigger-price-wrap").hidden = type !== "STOPLOSS";
      $("#bracket").hidden = side !== "BUY";
      $("#stop-loss-wrap").hidden = !$("#use-sl").checked;
      $("#target-price-wrap").hidden = !$("#use-target").checked;
      const price = entry();
      const amount = price * qty();
      const brokerage = amount * brokeragePct;
      $("#estimate-price-label").textContent = type === "MARKET" ? "Market price" : type === "LIMIT" ? "Limit price" : "Trigger price";
      $("#estimate-price").textContent = price ? money(price) : "—";
      $("#estimate-value").textContent = money(amount);
      $("#estimate-brokerage").textContent = money(brokerage);
      $("#estimate-total").textContent = money(side === "BUY" ? amount + brokerage : amount - brokerage);
      $("#funds-label").textContent = side === "BUY" ? "Available cash" : "Shares you hold";
      $("#funds").textContent = side === "BUY" ? money(cash) : held.toLocaleString("en-IN");
      $("#funds").className = side === "BUY" ? (amount + brokerage > cash ? "negative" : "") : qty() > held ? "negative" : "";
      $("#holding-hint").textContent =
        side === "BUY" ? `Max ≈ ${Math.max(0, Math.floor(cash / (Number(stock.adjusted_price) * (1 + brokeragePct)))).toLocaleString("en-IN")} shares` : held ? `You can sell up to ${held}` : "You don't hold this stock";

      const sl = $("#use-sl").checked ? num("#stop-loss") : 0;
      const tg = $("#use-target").checked ? num("#target-price") : 0;
      const pct = (v) => (price ? ((v - price) / price) * 100 : 0);
      if ($("#stop-loss-hint")) $("#stop-loss-hint").textContent = sl ? `${percent(pct(sl))} · risk ${money((price - sl) * qty())}` : "";
      if ($("#target-price-hint")) $("#target-price-hint").textContent = tg ? `${percent(pct(tg))} · reward ${money((tg - price) * qty())}` : "";
      const rr = $("#risk-reward");
      rr.innerHTML = sl && tg && price > sl ? `Risk : reward <strong>1 : ${((tg - price) / (price - sl)).toFixed(2)}</strong>` : "";

      const verb = side === "BUY" ? "Buy" : "Sell";
      $("#trade-button").textContent = type === "MARKET" ? `${verb} ${stock.symbol}` : `Place ${type === "LIMIT" ? "limit" : "stop"} ${verb.toLowerCase()}`;
    }

    const prefill = () => {
      const p = Number(stock.adjusted_price);
      const round = (v) => (Math.round(v * 20) / 20).toFixed(2);
      if (!$("#limit-price").value) $("#limit-price").value = round(p);
      if (!$("#trigger-price").value) $("#trigger-price").value = round(side === "BUY" ? p * 1.01 : p * 0.99);
      if (!$("#stop-loss").value) $("#stop-loss").value = round(p * 0.98);
      if (!$("#target-price").value) $("#target-price").value = round(p * 1.04);
    };

    $$(".side-switch [data-side]").forEach(
      (button) =>
        (button.onclick = () => {
          side = button.dataset.side;
          $$(".side-switch [data-side]").forEach((item) => item.classList.toggle("active", item === button));
          $("#trigger-price").value = "";
          prefill();
          update();
        }),
    );
    $$("[data-type]").forEach(
      (button) =>
        (button.onclick = () => {
          type = button.dataset.type;
          $$("[data-type]").forEach((item) => {
            item.classList.toggle("active", item === button);
            item.setAttribute("aria-checked", String(item === button));
          });
          update();
        }),
    );
    ["#quantity", "#limit-price", "#trigger-price", "#stop-loss", "#target-price"].forEach((id) => ($(id).oninput = update));
    ["#use-sl", "#use-target"].forEach((id) => ($(id).onchange = update));
    $("#qty-decrease").onclick = () => {
      quantity.value = String(Math.max(1, qty() - 1));
      update();
    };
    $("#qty-increase").onclick = () => {
      quantity.value = String(qty() + 1);
      update();
    };

    async function renderOpenOrders() {
      try {
        const pending = (await api.orders()).filter((o) => o.status === "PENDING" && o.instrument_id === stock.instrument_id);
        stockChart?.setOrderLines?.(pending);
        $("#open-orders").innerHTML = pending.length
          ? `<span class="eyebrow">OPEN ORDERS</span>${pending
              .map((o) => {
                const level = o.order_type === "LIMIT" ? o.limit_price : o.trigger_price;
                const label = o.parent_order_id ? (o.order_type === "STOPLOSS" ? "Stop-loss" : "Target") : `${o.order_type === "LIMIT" ? "Limit" : "Stop"} ${o.side.toLowerCase()}`;
                return `<div class="open-order"><span class="badge ${o.side.toLowerCase()}">${o.side}</span><div><strong>${label}</strong><small>${o.quantity} @ ${money(level)}</small></div><button type="button" class="ghost-button" data-cancel="${o.order_id}">Cancel</button></div>`;
              })
              .join("")}`
          : "";
        $$("[data-cancel]").forEach(
          (b) =>
            (b.onclick = async () => {
              b.disabled = true;
              try {
                await api.cancelOrder(b.dataset.cancel);
                toast("Order cancelled");
              } catch (error) {
                toast(error.message, "error");
              }
              renderOpenOrders();
            }),
        );
      } catch {
        // open orders are a convenience; the Orders page is the record
      }
    }

    $("#trade-button").onclick = async () => {
      const amount = qty();
      const button = $("#trade-button");
      const feedback = $("#trade-feedback");
      feedback.classList.add("hidden");
      const bracket =
        side === "BUY"
          ? {
              stop_loss: $("#use-sl").checked ? num("#stop-loss") || undefined : undefined,
              target_price: $("#use-target").checked ? num("#target-price") || undefined : undefined,
            }
          : {};
      button.disabled = true;
      button.classList.add("is-loading");
      button.textContent = "Placing…";
      try {
        if (type === "MARKET") {
          const result = await api.trade(side, {
            instrument_id: stock.instrument_id,
            quantity: amount,
            client_order_id: crypto.randomUUID(),
            ...bracket,
          });
          const impact = Number(result.price_impact);
          const exits = [bracket.stop_loss && `stop-loss ${money(bracket.stop_loss)}`, bracket.target_price && `target ${money(bracket.target_price)}`].filter(Boolean);
          $("#trade-result").className = "trade-result visible";
          $("#trade-result").innerHTML = `<span class="success-mark">${svgIcon(ICONS.check)}</span><div><span class="eyebrow">ORDER EXECUTED</span><h2>${side} ${amount} ${escapeHTML(stock.symbol)}</h2><div class="result-grid"><div><span>Fill price</span><strong>${money(result.exec_price)}</strong></div><div><span>${side === "BUY" ? "Total cost" : "Proceeds"}</span><strong>${money(result.total_value)}</strong></div><div><span>Brokerage</span><strong>${money(result.brokerage)}</strong></div><div><span>Your price impact</span><strong class="${tone(impact)}">${impactPct(impact)}</strong></div>${result.realised_pl != null ? `<div><span>Realised P&L</span><strong class="${tone(result.realised_pl)}">${signed(result.realised_pl)}</strong></div>` : ""}</div>${exits.length ? `<p class="helper">Exit orders placed: ${exits.join(" and ")}. Whichever hits first cancels the other.</p>` : ""}</div>`;
          toast(`${side === "BUY" ? "Bought" : "Sold"} ${amount} ${stock.symbol} at ${money(result.exec_price)}`, "success");
        } else {
          await api.placeOrder({
            instrument_id: stock.instrument_id,
            side,
            order_type: type,
            quantity: amount,
            limit_price: type === "LIMIT" ? num("#limit-price") : undefined,
            trigger_price: type === "STOPLOSS" ? num("#trigger-price") : undefined,
            client_order_id: crypto.randomUUID(),
            ...bracket,
          });
          toast(`${type === "LIMIT" ? "Limit" : "Stop"} ${side.toLowerCase()} placed · waiting for ${money(entry())}`, "success");
        }
        const previous = Number(stock.adjusted_price);
        Object.assign(stock, await api.stock(stock.instrument_id));
        const priceEl = $("#stock-price");
        if (priceEl && type === "MARKET") {
          tweenNumber(priceEl, previous, Number(stock.adjusted_price), money);
          const flash = Number(stock.adjusted_price) >= previous ? "price-flash-up" : "price-flash-down";
          priceEl.classList.remove("price-flash-up", "price-flash-down");
          void priceEl.offsetWidth;
          priceEl.classList.add(flash);
          setTimeout(() => priceEl.classList.remove(flash), 650);
        }
        refreshStock?.();
        await Promise.all([loadAccount(), renderOpenOrders()]);
      } catch (error) {
        feedback.className = "trade-feedback error visible";
        feedback.innerHTML = `<strong>Order not placed</strong><span>${escapeHTML(error.message)}</span>`;
        toast(error.message, "error");
      } finally {
        button.disabled = false;
        button.classList.remove("is-loading");
        update();
      }
    };

    prefill();
    update();
    await Promise.all([loadAccount(), renderOpenOrders()]);
    // Keep the desk honest while it's open: fills, cash and the market price change underneath it.
    refreshDesk = () => {
      $("#estimate-price") && type === "MARKET" && update();
      renderOpenOrders();
      loadAccount();
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
                  `<tr><td data-label="Username"><a class="user-name-link" href="developer-user.html?id=${item.id}">${escapeHTML(item.username)}</a>${item.is_admin ? '<span class="badge admin">ADMIN</span>' : ""}</td><td data-label="Email">${escapeHTML(item.email)}</td><td data-label="Joined">${utcDate(item.created_at).toLocaleDateString("en-IN")}</td><td data-label="Cash balance">${money(item.cash_balance)}</td><td data-label="Portfolio">${money(item.portfolio_value)}</td><td data-label="P&L" class="${tone(item.unrealised_pnl)}">${signed(item.unrealised_pnl)}</td><td data-label="Trades">${item.trade_count}</td></tr>`,
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
        `<section class="panel system-controls"><div><span class="eyebrow">SYSTEM CONTROL</span><h2>Reset the simulated market</h2><p class="helper">Wipes all order books, resets every account to ${money(summary.starting_cash)} virtual cash, and re-anchors MockFolio prices to the reference price. This cannot be undone.</p></div><button class="ghost-button danger" id="open-reset-market">${svgIcon(ICONS.warning)}Reset market</button></section><dialog class="confirm-dialog" id="reset-market-dialog"><div class="confirm-dialog-icon warning">${svgIcon(ICONS.warning)}</div><h3>Reset the simulated market?</h3><p class="helper">This archives <strong>${summary.total_trades}</strong> executed trades and <strong>${summary.total_orders}</strong> orders, and restores all <strong>${summary.total_users}</strong> accounts to ${money(summary.starting_cash)} virtual cash. This cannot be undone.</p><label for="reset-market-confirm-input">Type <strong>CONFIRM-RESET</strong> to proceed</label><input id="reset-market-confirm-input" autocomplete="off" placeholder="CONFIRM-RESET" /><div class="confirm-dialog-actions"><button type="button" class="ghost-button" id="reset-market-cancel">Cancel</button><button type="button" class="primary-button danger" id="reset-market-confirm" disabled>Reset market</button></div></dialog>`;
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
          toast(`Market reset. Every account is back to ${money(summary.starting_cash)}.`, "success");
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
                `<tr><td data-label="Date">${stamp(item.executed_at)}</td><td data-label="Stock">${escapeHTML(item.symbol)}</td><td data-label="Side"><span class="badge ${item.side.toLowerCase()}">${item.side}</span></td><td data-label="Quantity">${item.quantity}</td><td data-label="Fill price">${money(item.exec_price)}</td><td data-label="Brokerage">${money(item.brokerage)}</td><td data-label="Impact" class="${tone(item.price_impact)}">${impactPct(item.price_impact)}</td><td data-label="Before">${money(item.pre_trade_price)}</td><td data-label="After">${money(item.exec_price)}</td></tr>`,
            )
            .join("")
        : '<tr><td colspan="9"><div class="empty-state"><strong>This user has not made any trades yet.</strong></div></td></tr>';
      const orderRows = orders.length
        ? orders
            .map(
              (item) =>
                `<tr><td data-label="Date">${stamp(item.created_at)}</td><td data-label="Stock">${escapeHTML(item.symbol)}</td><td data-label="Type"><span class="badge ${item.side.toLowerCase()}">${item.side}</span> ${orderTypeLabel(item)}</td><td data-label="Quantity">${item.quantity}</td><td data-label="Price">${item.limit_price ? money(item.limit_price) : item.trigger_price ? `trigger ${money(item.trigger_price)}` : "Market"}</td><td data-label="Status"><span class="badge status-${item.status.toLowerCase()}">${item.status}</span></td></tr>`,
            )
            .join("")
        : '<tr><td colspan="6"><div class="empty-state"><strong>No orders yet.</strong></div></td></tr>';
      const accountStats = [
        adminSummaryCard("Cash balance", money(account.cash_balance)),
        adminSummaryCard("Portfolio value", money(account.portfolio_value)),
        adminSummaryCard("Total account value", money(account.total_account_value)),
        adminSummaryCard("Unrealised P&L", signed(account.unrealised_pnl), "Open positions", tone(account.unrealised_pnl)),
        adminSummaryCard("Realised P&L", signed(account.realised_pl), "Closed trades", tone(account.realised_pl)),
        adminSummaryCard("Trades · orders", `${account.trade_count} · ${account.order_count}`),
      ].join("");
      $("#developer-user-content").innerHTML =
        `<section class="user-hero panel"><span class="avatar">${escapeHTML(user.username[0]?.toUpperCase())}</span><div><span class="eyebrow">USER PROFILE</span><h1>${escapeHTML(user.username)}</h1><p>${escapeHTML(user.email)}</p></div></section><section class="profile-grid panel profile-table">${row("User ID", user.id)}${row("Username", escapeHTML(user.username))}${row("Name", escapeHTML(user.username))}${row("Email", escapeHTML(user.email))}${row("Account type", user.is_admin ? "Developer / Admin" : "Standard user")}${row("Joined", utcDate(user.created_at).toLocaleString("en-IN"))}</section><section class="section-heading spaced"><div><span class="eyebrow">ACCOUNT SUMMARY</span><h2>Account overview</h2></div></section><section class="stats">${accountStats}</section><section class="section-heading spaced"><div><span class="eyebrow">CURRENT HOLDINGS</span><h2>Positions</h2></div></section><div class="table-wrap"><table><thead><tr><th>Stock</th><th>Quantity</th><th>Average buy</th><th>Current price</th><th>P&L</th></tr></thead><tbody>${holdings}</tbody></table></div><section class="section-heading spaced"><div><span class="eyebrow">TRADES</span><h2>Trade history</h2></div></section><div class="table-wrap"><table><thead><tr><th>Date</th><th>Stock</th><th>Side</th><th>Quantity</th><th>Fill price</th><th>Brokerage</th><th>Impact</th><th>Before</th><th>After</th></tr></thead><tbody>${tradeRows}</tbody></table></div><section class="section-heading spaced"><div><span class="eyebrow">ORDERS</span><h2>Order history</h2></div></section><div class="table-wrap"><table><thead><tr><th>Date</th><th>Stock</th><th>Type</th><th>Quantity</th><th>Requested price</th><th>Status</th></tr></thead><tbody>${orderRows}</tbody></table></div><section class="panel system-controls"><div><span class="eyebrow">ADMINISTRATIVE CONTROLS</span><h2>Reset this account</h2><p class="helper">Liquidates all open holdings, clears any orders, and restores ${escapeHTML(user.username)}'s balance to ${money(account.starting_cash)} virtual cash. This cannot be undone.</p></div><button class="ghost-button danger" id="open-reset-account">${svgIcon(ICONS.warning)}Reset account</button></section><dialog class="confirm-dialog" id="reset-account-dialog"><div class="confirm-dialog-icon warning">${svgIcon(ICONS.warning)}</div><h3>Reset ${escapeHTML(user.username)}'s account?</h3><p class="helper">This liquidates ${detail.holdings.length} holding${detail.holdings.length === 1 ? "" : "s"}, clears any open orders, and sets virtual cash back to ${money(account.starting_cash)}. This cannot be undone.</p><div class="confirm-dialog-actions"><button type="button" class="ghost-button" id="reset-account-cancel">Cancel</button><button type="button" class="primary-button danger" id="reset-account-confirm">Reset account</button></div></dialog>`;
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

  async function loadSettings() {
    const host = $("#settings-content");
    try {
      const settings = await api.settings();
      const editable = settings.some((item) => item.editable);
      const note = editable
        ? `<div class="settings-note">${svgIcon(ICONS.warning)}<span>These apply to <strong>every</strong> account immediately. Changes take up to 15 seconds to reach the price engine.</span></div>`
        : `<div class="settings-note">${svgIcon(ICONS.lock)}<span>These values are shared by everyone trading in this market, so only admins can change them. Here's what each one does.</span></div>`;
      host.innerHTML =
        note +
        `<div class="settings-grid">${settings
          .map(
            (item) =>
              `<form class="panel setting-card" data-key="${escapeHTML(item.key)}"><div class="setting-head"><label for="setting-${escapeHTML(item.key)}">${escapeHTML(item.label)}</label><code>${escapeHTML(item.key)}</code></div><p>${escapeHTML(item.description)}</p><div class="setting-row">${
                item.editable
                  ? `<input id="setting-${escapeHTML(item.key)}" type="number" step="any" min="${item.min}" max="${item.max}" value="${escapeHTML(item.value)}" required /><button class="primary-button" type="submit">Save</button>`
                  : `<strong id="setting-${escapeHTML(item.key)}" class="setting-value">${escapeHTML(item.value)}</strong>`
              }</div><small class="setting-range">Allowed: ${item.min} – ${Number(item.max).toLocaleString("en-IN")}</small></form>`,
          )
          .join("")}</div>`;
      $$(".setting-card").forEach(
        (form) =>
          (form.onsubmit = async (event) => {
            event.preventDefault();
            const input = form.querySelector("input");
            const button = form.querySelector("button");
            button.disabled = true;
            try {
              await api.updateSetting(form.dataset.key, input.value);
              toast(`${form.querySelector("label").textContent} updated`, "success");
            } catch (error) {
              toast(error.message, "error");
            } finally {
              button.disabled = false;
            }
          }),
      );
    } catch (error) {
      host.innerHTML = `<div class="error-state">${escapeHTML(error.message)}</div>`;
    }
  }

  // TradingView's Top Stories feed is curated per market; it carries no stories for individual Indian stocks.
  function loadNews() {
    const controls = $("#news-controls");
    controls.innerHTML = `<div><span class="eyebrow">FEED</span><h2>Top stories</h2></div><div class="toolbar-actions"><label class="sr-only" for="news-feed">News feed</label><select id="news-feed"><option value="all">All markets</option><option value="market:stock">Stocks</option><option value="market:index">Indices</option><option value="market:economic">Economy</option><option value="market:forex">Currencies</option><option value="market:futures">Commodities & futures</option></select></div>`;
    const draw = () => {
      const [mode, value] = $("#news-feed").value.split(/:(.*)/);
      $("#news-controls h2").textContent = $("#news-feed").selectedOptions[0].textContent;
      TV?.embed($("#tv-news"), "timeline", (colorTheme) => ({
        feedMode: mode === "all" ? "all_symbols" : mode,
        ...(mode === "market" ? { market: value } : {}),
        ...(mode === "symbol" ? { symbol: value } : {}),
        isTransparent: true,
        displayMode: "regular",
        width: "100%",
        height: "100%",
        colorTheme,
        locale: "en",
      }));
    };
    $("#news-feed").onchange = draw;
    draw();
  }

  const COUNTRIES = [
    ["in", "India"],
    ["us", "United States"],
    ["eu", "Euro area"],
    ["gb", "United Kingdom"],
    ["cn", "China"],
    ["jp", "Japan"],
  ];
  const MAP_REGIONS = [
    ["", "World"],
    ["asia", "Asia"],
    ["europe", "Europe"],
    ["north-america", "North America"],
    ["africa", "Africa"],
    ["oceania", "Oceania"],
  ];
  function loadEconomyMap() {
    let region = "asia";
    $("#map-controls").innerHTML = `<div><span class="eyebrow">WORLD ECONOMICS</span><h2>Economic map</h2></div><div class="chip-group" role="group" aria-label="Region">${MAP_REGIONS.map(([code, name]) => `<button type="button" class="chip${code === region ? " active" : ""}" aria-pressed="${code === region}" data-region="${code}">${name}</button>`).join("")}</div>`;
    const draw = () => TV?.embedComponent($("#tv-economic-map"), "tv-economic-map", (theme) => ({ theme, region: region || null, transparent: true }));
    $$("[data-region]").forEach(
      (chip) =>
        (chip.onclick = () => {
          region = chip.dataset.region;
          $$("[data-region]").forEach((c) => {
            c.classList.toggle("active", c === chip);
            c.setAttribute("aria-pressed", String(c === chip));
          });
          draw();
        }),
    );
    draw();
  }

  function loadEconomy() {
    loadEconomyMap();
    const picked = new Set(["in", "us"]);
    $("#economy-controls").innerHTML = `<div class="chip-group" role="group" aria-label="Countries">${COUNTRIES.map(([code, name]) => `<button type="button" class="chip${picked.has(code) ? " active" : ""}" aria-pressed="${picked.has(code)}" data-country="${code}">${name}</button>`).join("")}</div><div class="toolbar-actions"><label class="sr-only" for="economy-importance">Importance</label><select id="economy-importance"><option value="-1,0,1">All events</option><option value="0,1" selected>Medium & high impact</option><option value="1">High impact only</option></select></div>`;
    const draw = () =>
      TV?.embed($("#tv-economy"), "events", (colorTheme) => ({
        colorTheme,
        isTransparent: true,
        width: "100%",
        height: "100%",
        locale: "en",
        importanceFilter: $("#economy-importance").value,
        countryFilter: [...picked].join(","),
      }));
    $$("[data-country]").forEach(
      (chip) =>
        (chip.onclick = () => {
          const code = chip.dataset.country;
          if (picked.has(code) && picked.size === 1) return; // keep at least one country
          picked.has(code) ? picked.delete(code) : picked.add(code);
          chip.classList.toggle("active", picked.has(code));
          chip.setAttribute("aria-pressed", String(picked.has(code)));
          draw();
        }),
    );
    $("#economy-importance").onchange = draw;
    draw();
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
      if (page === "settings") await loadSettings();
      if (page === "news") loadNews();
      if (page === "economy") loadEconomy();
      if (page === "developer") await loadDeveloper();
      if (page === "developer-user") await loadDeveloperUser();
    } catch (error) {
      toast(error.message, "error");
    }
  }
  window.addEventListener("mockfolio-theme-change", updateThemeToggle);
  start();
})();
