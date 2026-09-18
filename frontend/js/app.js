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

  function loading(selector, message) {
    if ($(selector))
      $(selector).innerHTML =
        `<div class="loading"><span class="spinner"></span>${message}</div>`;
  }

  function renderShell(user) {
    const active = (name) => (page === name ? "active" : "");
    const avatarInitial = escapeHTML(
      (user.name || user.username || "U").trim().charAt(0).toUpperCase() || "U",
    );
    const developerLink = user.is_admin
      ? `<a class="${active("developer")}" href="developer.html">Developer</a>`
      : "";
    $("#app").insertAdjacentHTML(
      "afterbegin",
      `<header class="topbar"><a class="brand" href="index.html"><span class="brand-mark">M</span><span>mockfolio</span></a><nav class="desktop-nav"><a class="${active("market")}" href="index.html">Market</a><a class="${active("watchlist")}" href="watchlist.html">Watchlist</a><a class="${active("portfolio")}" href="portfolio.html">Portfolio</a><a class="${active("orders")}" href="orders.html">Orders</a>${developerLink}</nav><div class="top-actions"><button class="theme-toggle icon-button" id="theme-toggle" title="Switch theme">◐</button><span class="user-chip">${escapeHTML(user.username)}</span><a class="nav-avatar" href="profile.html" title="Open profile" aria-label="Open profile">${avatarInitial}</a><button class="logout-button" id="logout">Logout</button></div></header>`,
    );
    $("#app").insertAdjacentHTML(
      "beforeend",
      `${user.is_admin && page !== "profile" ? '<div class="read-only-notice">Developer Account <span>Trading Disabled</span></div>' : ""}<nav class="mobile-nav"><a class="${active("market")}" href="index.html">⌂<span>Market</span></a><a class="${active("watchlist")}" href="watchlist.html">☆<span>Watchlist</span></a><a class="${active("portfolio")}" href="portfolio.html">◫<span>Portfolio</span></a><a class="${active("orders")}" href="orders.html">≡<span>Orders</span></a><a class="${active("profile")}" href="profile.html">${avatarInitial}<span>Profile</span></a></nav>`,
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
      toggle.textContent = dark ? "☀" : "◐";
      toggle.title = dark ? "Switch to light mode" : "Switch to dark mode";
    }
    if (priceChart) applyChartTheme();
  }

  function renderStats(summary) {
    if (!$("#stats")) return;
    $("#stats").innerHTML = [
      ["Total account value", summary.total_account_value],
      ["Cash balance", summary.cash_balance],
      ["Holdings value", summary.holdings_value],
      ["Total P&L", summary.total_pnl],
    ]
      .map(
        ([label, value]) =>
          `<div class="stat"><span>${label}</span><strong class="${tone(value)}">${money(value)}</strong></div>`,
      )
      .join("");
  }

  function stockRow(stock, starred) {
    const deviation = Number(stock.deviation);
    return `<tr><td><a class="stock-name" href="stock.html?id=${stock.id}"><strong>${escapeHTML(stock.symbol)}</strong><small>${escapeHTML(stock.company_name)}</small></a></td><td><strong class="market-price">${money(stock.simulated_price)}</strong><small>MockFolio price</small></td><td>${money(stock.reference_price)}</td><td><span class="${tone(deviation)}">${signed(deviation)}</span><small class="${tone(deviation)}">${percent(stock.deviation_percentage)}</small></td><td><button class="table-action" data-watch="${stock.id}" title="${starred ? "Remove from watchlist" : "Add to watchlist"}">${starred ? "★" : "☆"}</button><a class="trade-link" href="stock.html?id=${stock.id}">${currentUser?.is_admin ? "Inspect" : "Inspect"}</a></td></tr>`;
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
              watchlist.push(stocks.find((item) => item.id === id));
              toast("Added to watchlist", "success");
            }
            page === "watchlist" ? await loadWatchlist() : await loadMarket();
          } catch (error) {
            toast(error.message, "error");
          }
        }),
    );
  }

  async function loadMarket() {
    loading("#market-table", "Loading market...");
    try {
      [stocks, watchlist] = await Promise.all([api.stocks(), api.watchlist()]);
      const render = () => {
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
      };
      render();
      $("#market-status-detail").textContent =
        `${stocks.length} active stocks · Simulation active`;
      $("#stock-search").oninput = render;
      $("#market-filter").onchange = render;
      renderStats(await api.summary());
    } catch (error) {
      $("#market-table").innerHTML =
        `<tr><td colspan="5"><div class="error-state">${escapeHTML(error.message)}</div></td></tr>`;
    }
  }

  async function loadPortfolio() {
    loading("#portfolio-table", "Loading portfolio...");
    try {
      const [summary, holdings] = await Promise.all([
        api.summary(),
        api.portfolio(),
      ]);
      renderStats(summary);
      $("#portfolio-table").innerHTML = holdings.length
        ? holdings
            .map(
              (item) =>
                `<tr><td><a class="stock-name" href="stock.html?id=${item.stock_id}"><strong>${escapeHTML(item.symbol)}</strong></a></td><td>${Number(item.quantity).toLocaleString("en-IN")}</td><td>${money(item.average_buy_price)}</td><td>${money(item.simulated_price)}</td><td>${money(item.invested_value)}</td><td>${money(item.current_value)}</td><td class="${tone(item.profit_loss)}"><strong>${signed(item.profit_loss)}</strong><small>${percent((Number(item.profit_loss) / Number(item.invested_value || 1)) * 100)}</small></td></tr>`,
            )
            .join("")
        : `<tr><td colspan="7"><div class="empty-state"><strong>Your portfolio is empty</strong><span>Start paper trading to build your portfolio.</span><a class="primary-button" href="index.html">Browse stocks</a></div></td></tr>`;
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
      $("#orders-table").innerHTML = orders.length
        ? orders
            .map(
              (item) =>
                `<tr><td>${new Date(item.created_at).toLocaleString("en-IN")}</td><td><strong>${escapeHTML(item.symbol)}</strong></td><td><span class="badge ${item.order_type.toLowerCase()}">${item.order_type}</span></td><td>${item.quantity}</td><td>${money(item.requested_price)}</td><td><span class="badge filled">${item.status}</span></td></tr>`,
            )
            .join("")
        : `<tr><td colspan="6"><div class="empty-state"><strong>No orders yet</strong><span>Your completed orders will appear here.</span></div></td></tr>`;
      $("#trades-table").innerHTML = trades.length
        ? trades
            .map(
              (item) =>
                `<tr><td>${new Date(item.created_at).toLocaleString("en-IN")}</td><td><strong>${escapeHTML(item.symbol)}</strong></td><td><span class="badge ${item.side.toLowerCase()}">${item.side}</span></td><td>${item.quantity}</td><td>${money(item.fill_price)}</td><td>${money(item.brokerage)}</td><td class="${tone(item.price_impact)}">${signed(item.price_impact)}</td></tr>`,
            )
            .join("")
        : `<tr><td colspan="7"><div class="empty-state"><strong>No trades yet</strong><span>Execute a trade to see its price impact here.</span></div></td></tr>`;
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function loadWatchlist() {
    loading("#watchlist-table", "Loading watchlist...");
    try {
      watchlist = await api.watchlist();
      stocks = watchlist;
      $("#watchlist-table").innerHTML = watchlist.length
        ? watchlist.map((stock) => stockRow(stock, true)).join("")
        : `<tr><td colspan="5"><div class="empty-state"><strong>Your watchlist is empty</strong><span>Star a stock from the market to keep it close.</span><a class="primary-button" href="index.html">Explore market</a></div></td></tr>`;
      bindWatchButtons();
    } catch (error) {
      toast(error.message, "error");
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
        `<section class="profile-hero"><div><span class="eyebrow">PROFILE / ACCOUNT</span><h1>Hi, ${escapeHTML(user.name || user.username)}</h1><p>Your paper-trading account.</p></div>${user.is_admin ? '<span class="account-status"><strong>Developer Account</strong><small>Trading disabled</small></span>' : ""}</section><section class="portfolio-summary panel"><span class="eyebrow">PORTFOLIO</span><strong class="portfolio-total">${money(summary.total_account_value)}</strong><span class="summary-label">Total account value</span><div class="summary-metrics"><div><span>Invested</span><strong>${money(invested)}</strong></div><div><span>Current value</span><strong>${money(summary.holdings_value)}</strong></div><div><span>P&L</span><strong class="${tone(summary.total_pnl)}">${signed(summary.total_pnl)} <small>(${percent(pnlPercent)})</small></strong></div></div></section><section class="profile-metrics"><div><span>Available cash</span><strong>${money(summary.cash_balance)}</strong></div><div><span>Invested value</span><strong>${money(invested)}</strong></div><div><span>Current value</span><strong>${money(summary.holdings_value)}</strong></div><div><span>Total P&L</span><strong class="${tone(summary.total_pnl)}">${signed(summary.total_pnl)}</strong></div></section><section class="profile-section"><div class="section-heading"><div><span class="eyebrow">YOUR BOOK</span><h2>Your holdings</h2></div></div><div class="table-wrap"><table><thead><tr><th>Stock</th><th>Qty</th><th>Avg. price</th><th>Simulated price</th><th>Current value</th><th>P&L</th></tr></thead><tbody>${holdings.length ? holdings.map((item) => `<tr><td><a class="stock-name" href="stock.html?id=${item.stock_id}"><strong>${escapeHTML(item.symbol)}</strong><small>${escapeHTML(item.company_name || "")}</small></a></td><td>${Number(item.quantity).toLocaleString("en-IN")}</td><td>${money(item.average_buy_price)}</td><td>${money(item.simulated_price)}</td><td>${money(item.current_value)}</td><td class="${tone(item.profit_loss)}"><strong>${signed(item.profit_loss)}</strong></td></tr>`).join("") : '<tr><td colspan="6"><div class="empty-state"><strong>Your portfolio is empty</strong><span>Start paper trading to build your portfolio.</span><a class="primary-button" href="index.html">Browse stocks</a></div></td></tr>'}</tbody></table></div></section><section class="profile-section"><div class="section-heading"><div><span class="eyebrow">ACTIVITY</span><h2>Recent activity</h2></div></div><div class="table-wrap"><table><thead><tr><th>Side</th><th>Stock</th><th>Quantity</th><th>Fill price</th><th>Price impact</th><th>Date</th></tr></thead><tbody>${activity.length ? activity.map((item) => `<tr><td><span class="badge ${item.side.toLowerCase()}">${item.side}</span></td><td><strong>${escapeHTML(item.symbol)}</strong></td><td>${item.quantity}</td><td>${money(item.fill_price)}</td><td class="${tone(item.price_impact)}">${signed(item.price_impact)}</td><td>${new Date(item.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td></tr>`).join("") : '<tr><td colspan="6"><div class="empty-state"><strong>No recent activity</strong></div></td></tr>'}</tbody></table></div></section><section class="profile-section account-section"><div class="section-heading"><div><span class="eyebrow">ACCOUNT</span><h2>Account information</h2></div></div><div class="account-grid panel">${profileRow("Username", escapeHTML(user.username))}${profileRow("Email", escapeHTML(user.email))}${profileRow("Account type", user.is_admin ? "Developer · Trading disabled" : "Standard user")}${profileRow("Member since", new Date(user.created_at).toLocaleDateString("en-IN"))}</div></section>`;
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
            borderColor: "#0b756d",
            backgroundColor: "rgba(11,117,109,.08)",
            fill: true,
            tension: 0.25,
          },
          {
            label: "Reference Price",
            data: points.map((item) => item.reference_price),
            borderColor: "#8a98a5",
            backgroundColor: "transparent",
            tension: 0.25,
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
            grid: { color: "#e8edf0" },
          },
          x: { grid: { display: false } },
        },
      },
    });
    applyChartTheme();
  }

  function applyChartTheme() {
    if (!priceChart) return;
    const styles = getComputedStyle(document.documentElement);
    const text = styles.getPropertyValue("--muted").trim();
    const grid = styles.getPropertyValue("--border").trim();
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

  async function loadStock() {
    const id = new URLSearchParams(location.search).get("id");
    try {
      let stock = await api.stock(id);
      const history = await api.history(id);
      $("#stock-content").innerHTML =
        `<div class="stock-heading"><div><span class="eyebrow">${escapeHTML(stock.sector)}</span><h1>${escapeHTML(stock.company_name)}</h1><p class="symbol-label">${escapeHTML(stock.symbol)}</p></div><div class="price-block"><span>MockFolio price</span><strong>${money(stock.simulated_price)}</strong><em class="${tone(stock.deviation)}">${signed(stock.deviation)} (${percent(stock.deviation_percentage)})</em></div></div><div class="stock-grid"><section class="panel chart-panel"><div class="panel-heading"><div><span class="eyebrow">PRICE STORY</span><h2>MockFolio price history</h2></div><span class="legend"><i></i> Reference <i></i> Simulated</span></div><canvas id="price-chart"></canvas><div id="chart-empty" class="empty-state compact hidden">No price history yet. Your first trade will create a point.</div></section>${currentUser?.is_admin ? '<aside class="panel trade-panel read-only-panel"><span class="eyebrow">DEVELOPER ACCOUNT</span><h2>Trading disabled</h2><p class="helper">Developer accounts can inspect the simulated market but cannot place BUY or SELL orders.</p></aside>' : '<aside class="panel trade-panel"><div class="segmented"><button class="active" data-side="BUY">Buy</button><button data-side="SELL">Sell</button></div><label>Quantity<input id="quantity" type="number" min="1" step="1" value="10"></label><div class="estimate"><div><span>Current price</span><strong id="estimate-price">${money(stock.simulated_price)}</strong></div><div><span>Estimated amount</span><strong id="estimate-value">${money(stock.simulated_price * 10)}</strong></div><div><span>Brokerage (0.1%)</span><strong id="estimate-brokerage">${money(stock.simulated_price * 10 * 0.001)}</strong></div><div class="estimate-total"><span>Estimated total</span><strong id="estimate-total">${money(stock.simulated_price * 10 * 1.001)}</strong></div></div><button class="primary-button full" id="trade-button">Buy stock</button><p class="helper">Your fill price is determined by the server. A trade changes the shared simulated market price.</p></aside>'}</div><section id="trade-result" class="trade-result hidden"></section>`;
      $("#trade-result").insertAdjacentHTML(
        "beforebegin",
        `<section class="market-info panel"><div><span>MockFolio price</span><strong>${money(stock.simulated_price)}</strong></div><div><span>Reference price</span><strong>${money(stock.reference_price)}</strong></div><div><span>Deviation</span><strong class="${tone(stock.deviation)}">${percent(stock.deviation_percentage)}</strong></div><div><span>Sector</span><strong>${escapeHTML(stock.sector)}</strong></div></section>`,
      );
      if (!currentUser?.is_admin) {
        const initialAmount = Number(stock.simulated_price) * 10;
        $("#estimate-price").textContent = money(stock.simulated_price);
        $("#estimate-value").textContent = money(initialAmount);
        $("#estimate-brokerage").textContent = money(initialAmount * 0.001);
        $("#estimate-total").textContent = money(initialAmount * 1.001);
        $("#trade-button").insertAdjacentHTML(
          "afterend",
          `<div id="trade-feedback" class="trade-feedback hidden"></div>`,
        );
      }
      drawChart(history);
      if (!currentUser?.is_admin) bindTrade(stock);
    } catch (error) {
      $("#stock-content").innerHTML =
        `<div class="error-state">${escapeHTML(error.message)}</div>`;
    }
  }

  function bindTrade(stock) {
    let side = "BUY";
    const quantity = $("#quantity");
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
    $("#trade-button").onclick = async () => {
      const amount = Number(quantity.value);
      if (!Number.isInteger(amount) || amount <= 0) {
        toast("Enter a quantity greater than zero.", "error");
        return;
      }
      const button = $("#trade-button");
      button.disabled = true;
      button.textContent = "Executing...";
      try {
        const result = await api.trade(side, {
          stock_id: stock.id,
          quantity: amount,
          client_order_key: crypto.randomUUID(),
        });
        const impact = Number(result.price_impact);
        $("#trade-result").className = "trade-result visible";
        $("#trade-result").innerHTML =
          `<span class="success-mark">✓</span><div><span class="eyebrow">TRADE EXECUTED</span><h2>${side} ${escapeHTML(stock.symbol)}</h2><div class="result-grid"><div><span>Fill price</span><strong>${money(result.fill_price)}</strong></div><div><span>Total</span><strong>${money(result.total_cost)}</strong></div><div><span>Price impact</span><strong class="${tone(impact)}">${signed(impact)}</strong></div><div><span>New deviation</span><strong class="${tone(result.deviation_after_trade)}">${signed(result.deviation_after_trade)}</strong></div></div><div class="impact-story"><span>Before ${money(result.price_before)}</span><b>${side === "BUY" ? "↑ BUY IMPACT" : "↓ SELL IMPACT"} ${signed(impact)}</b><span>After ${money(result.price_after)}</span></div></div>`;
        toast("Trade executed successfully", "success");
        stock = await api.stock(stock.id);
        updateEstimate();
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
        button.textContent = `${side === "BUY" ? "Buy" : "Sell"} stock`;
      }
    };
  }

  function adminSummaryCard(label, value) {
    return `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`;
  }

  async function loadDeveloper() {
    try {
      const [users, summary] = await Promise.all([
        api.adminUsers(),
        api.adminSummary(),
      ]);
      $("#developer-stats").innerHTML = [
        adminSummaryCard("Total users", summary.total_users),
        adminSummaryCard("Total trades", summary.total_trades),
        adminSummaryCard("Total orders", summary.total_orders),
        adminSummaryCard("Active stocks", summary.active_stocks),
      ].join("");
      const render = () => {
        const query = $("#user-search").value.trim().toLowerCase();
        const filtered = users.filter((item) =>
          `${item.username} ${item.email}`.toLowerCase().includes(query),
        );
        $("#users-table").innerHTML = filtered.length
          ? filtered
              .map(
                (item) =>
                  `<tr><td><a class="user-name-link" href="developer-user.html?id=${item.id}">${escapeHTML(item.username)}</a>${item.is_admin ? '<span class="badge admin">ADMIN</span>' : ""}</td><td>${escapeHTML(item.email)}</td><td>${new Date(item.created_at).toLocaleDateString("en-IN")}</td><td>${money(item.cash_balance)}</td><td>${money(item.portfolio_value)}</td><td class="${tone(item.total_pnl)}">${signed(item.total_pnl)}</td><td>${item.trade_count}</td></tr>`,
              )
              .join("")
          : `<tr><td colspan="7"><div class="empty-state"><strong>No users found.</strong></div></td></tr>`;
      };
      $("#user-search").oninput = render;
      render();
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
      $("#developer-user-content").innerHTML =
        `<section class="user-hero panel"><span class="avatar">${escapeHTML(user.username[0]?.toUpperCase())}</span><div><span class="eyebrow">USER PROFILE</span><h1>${escapeHTML(user.username)}</h1><p>${escapeHTML(user.email)} · Joined ${new Date(user.created_at).toLocaleDateString("en-IN")}</p></div></section><section class="stats">${adminSummaryCard("Cash", money(detail.account.cash_balance))}${adminSummaryCard("Portfolio", money(detail.account.portfolio_value))}${adminSummaryCard("Account value", money(detail.account.total_account_value))}${adminSummaryCard("Total P&L", signed(detail.account.total_pnl))}</section><section class="section-heading"><div><span class="eyebrow">CURRENT HOLDINGS</span><h2>Positions</h2></div></section><div class="table-wrap"><table><thead><tr><th>Stock</th><th>Quantity</th><th>Average buy</th><th>Current price</th><th>P&L</th></tr></thead><tbody>${detail.holdings.length ? detail.holdings.map((item) => `<tr><td><strong>${item.symbol}</strong><small>${item.company_name}</small></td><td>${item.quantity}</td><td>${money(item.average_buy_price)}</td><td>${money(item.simulated_price)}</td><td class="${tone(item.profit_loss)}">${signed(item.profit_loss)}</td></tr>`).join("") : '<tr><td colspan="5"><div class="empty-state"><strong>No current holdings.</strong></div></td></tr>'}</tbody></table></div><section class="section-heading spaced"><div><span class="eyebrow">TRADES</span><h2>Trade history</h2></div></section><div class="table-wrap"><table><thead><tr><th>Date</th><th>Stock</th><th>Side</th><th>Quantity</th><th>Fill price</th><th>Brokerage</th><th>Impact</th><th>Before</th><th>After</th></tr></thead><tbody>${trades.length ? trades.map((item) => `<tr><td>${new Date(item.created_at).toLocaleString("en-IN")}</td><td>${item.symbol}</td><td><span class="badge ${item.side.toLowerCase()}">${item.side}</span></td><td>${item.quantity}</td><td>${money(item.fill_price)}</td><td>${money(item.brokerage)}</td><td class="${tone(item.price_impact)}">${signed(item.price_impact)}</td><td>${money(item.price_before)}</td><td>${money(item.price_after)}</td></tr>`).join("") : '<tr><td colspan="9"><div class="empty-state"><strong>This user has not made any trades yet.</strong></div></td></tr>'}</tbody></table></div><section class="section-heading spaced"><div><span class="eyebrow">ORDERS</span><h2>Order history</h2></div></section><div class="table-wrap"><table><thead><tr><th>Date</th><th>Stock</th><th>Type</th><th>Quantity</th><th>Requested price</th><th>Status</th></tr></thead><tbody>${orders.length ? orders.map((item) => `<tr><td>${new Date(item.created_at).toLocaleString("en-IN")}</td><td>${item.symbol}</td><td><span class="badge ${item.order_type.toLowerCase()}">${item.order_type}</span></td><td>${item.quantity}</td><td>${money(item.requested_price)}</td><td><span class="badge filled">${item.status}</span></td></tr>`).join("") : '<tr><td colspan="6"><div class="empty-state"><strong>No orders yet.</strong></div></td></tr>'}</tbody></table></div>`;
    } catch (error) {
      $("#developer-user-content").innerHTML =
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
                `<tr><td><strong>${escapeHTML(item.symbol)}</strong><small>${escapeHTML(item.company_name)}</small></td><td>${item.quantity}</td><td>${money(item.average_buy_price)}</td><td>${money(item.simulated_price)}</td><td class="${tone(item.profit_loss)}">${signed(item.profit_loss)}</td></tr>`,
            )
            .join("")
        : '<tr><td colspan="5"><div class="empty-state"><strong>No current holdings.</strong></div></td></tr>';
      const tradeRows = trades.length
        ? trades
            .map(
              (item) =>
                `<tr><td>${new Date(item.created_at).toLocaleString("en-IN")}</td><td>${escapeHTML(item.symbol)}</td><td><span class="badge ${item.side.toLowerCase()}">${item.side}</span></td><td>${item.quantity}</td><td>${money(item.fill_price)}</td><td>${money(item.brokerage)}</td><td class="${tone(item.price_impact)}">${signed(item.price_impact)}</td><td>${money(item.price_before)}</td><td>${money(item.price_after)}</td></tr>`,
            )
            .join("")
        : '<tr><td colspan="9"><div class="empty-state"><strong>This user has not made any trades yet.</strong></div></td></tr>';
      const orderRows = orders.length
        ? orders
            .map(
              (item) =>
                `<tr><td>${new Date(item.created_at).toLocaleString("en-IN")}</td><td>${escapeHTML(item.symbol)}</td><td><span class="badge ${item.order_type.toLowerCase()}">${item.order_type}</span></td><td>${item.quantity}</td><td>${money(item.requested_price)}</td><td><span class="badge filled">${item.status}</span></td></tr>`,
            )
            .join("")
        : '<tr><td colspan="6"><div class="empty-state"><strong>No orders yet.</strong></div></td></tr>';
      $("#developer-user-content").innerHTML =
        `<section class="user-hero panel"><span class="avatar">${escapeHTML(user.username[0]?.toUpperCase())}</span><div><span class="eyebrow">USER PROFILE</span><h1>${escapeHTML(user.username)}</h1><p>${escapeHTML(user.email)}</p></div></section><section class="profile-grid panel profile-table">${row("User ID", user.id)}${row("Username", escapeHTML(user.username))}${row("Name", escapeHTML(user.username))}${row("Email", escapeHTML(user.email))}${row("Account type", user.is_admin ? "Developer / Admin" : "Standard user")}${row("Joined", new Date(user.created_at).toLocaleString("en-IN"))}</section><section class="section-heading spaced"><div><span class="eyebrow">ACCOUNT SUMMARY</span><h2>Account overview</h2></div></section><section class="profile-grid panel profile-table">${row("Cash balance", money(account.cash_balance))}${row("Portfolio value", money(account.portfolio_value))}${row("Total account value", money(account.total_account_value))}${row("Total P&L", signed(account.total_pnl))}${row("Trade count", trades.length)}${row("Order count", orders.length)}</section><section class="section-heading spaced"><div><span class="eyebrow">CURRENT HOLDINGS</span><h2>Positions</h2></div></section><div class="table-wrap"><table><thead><tr><th>Stock</th><th>Quantity</th><th>Average buy</th><th>Current price</th><th>P&L</th></tr></thead><tbody>${holdings}</tbody></table></div><section class="section-heading spaced"><div><span class="eyebrow">TRADES</span><h2>Trade history</h2></div></section><div class="table-wrap"><table><thead><tr><th>Date</th><th>Stock</th><th>Side</th><th>Quantity</th><th>Fill price</th><th>Brokerage</th><th>Impact</th><th>Before</th><th>After</th></tr></thead><tbody>${tradeRows}</tbody></table></div><section class="section-heading spaced"><div><span class="eyebrow">ORDERS</span><h2>Order history</h2></div></section><div class="table-wrap"><table><thead><tr><th>Date</th><th>Stock</th><th>Type</th><th>Quantity</th><th>Requested price</th><th>Status</th></tr></thead><tbody>${orderRows}</tbody></table></div>`;
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
