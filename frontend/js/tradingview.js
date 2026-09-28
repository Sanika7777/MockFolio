// TradingView embed widgets (real market data, not MockFolio prices).
// Each widget is re-embedded when the light/dark theme changes, since
// TradingView only reads its colour theme at load time.
(() => {
  const mounted = new Set();
  const theme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

  // Free widgets aren't licensed for NSE data, so symbols use the company's BSE listing.
  // The base comes from the Yahoo ticker (TATAMOTORS now trades as TMPV).
  const symbol = (stock) => `BSE:${(stock.yf_ticker || stock.symbol).split(".")[0]}`;

  // Where a click on a symbol inside a widget should land: our stock page (?tvwidgetsymbol=BSE:XYZ).
  const chartUrl = () => `${location.origin}${location.pathname.replace(/[^/]*$/, "")}stock.html`;

  function track(entry) {
    mounted.forEach((other) => other.host === entry.host && mounted.delete(other));
    mounted.add(entry);
    entry.render();
    return entry;
  }

  // Newer widgets (e.g. the Economic Map) ship as web components: <tv-economic-map theme="dark">.
  const loadedModules = new Set();
  function embedComponent(host, tag, attrs) {
    if (!host) return null;
    const src = `https://widgets.tradingview-widget.com/w/en/${tag}.js`;
    if (!loadedModules.has(src)) {
      loadedModules.add(src);
      const script = document.createElement("script");
      script.type = "module";
      script.src = src;
      document.head.appendChild(script);
    }
    return track({
      host,
      render() {
        const el = document.createElement(tag);
        Object.entries(attrs(theme())).forEach(([k, v]) => v !== false && v != null && el.setAttribute(k, v === true ? "" : v));
        host.replaceChildren(el);
      },
    });
  }

  function embed(host, widget, config) {
    if (!host) return null;
    return track({
      host,
      render() {
        host.innerHTML =
          '<div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div></div>';
        const script = document.createElement("script");
        script.src = `https://s3.tradingview.com/external-embedding/embed-widget-${widget}.js`;
        script.async = true;
        script.textContent = JSON.stringify(config(theme()));
        host.firstElementChild.appendChild(script);
      },
    });
  }

  window.addEventListener("mockfolio-theme-change", () =>
    mounted.forEach((entry) => (entry.host.isConnected ? entry.render() : mounted.delete(entry))),
  );

  window.MockfolioTV = { embed, embedComponent, symbol, chartUrl };
})();
