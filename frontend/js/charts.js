// Lightweight Charts wrappers. Candlesticks use TradingView's default look;
// line / area charts use MockFolio's own tokens. Every chart re-themes itself
// when the light/dark toggle fires "mockfolio-theme-change".
(() => {
  const LWC = window.LightweightCharts;
  if (!LWC) return;

  const IST_OFFSET = 19800; // charts draw times as UTC, so shift to IST
  const toTime = (iso) =>
    Math.floor(Date.parse(/Z|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`) / 1000) + IST_OFFSET;
  const token = (name) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const rgba = (hex, alpha) => {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  };
  const isDark = () => document.documentElement.dataset.theme === "dark";
  const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const priceFormatter = (p) => `₹${inr.format(p)}`;

  // TradingView's stock palette (the library defaults) plus its classic dark layout.
  const TV = {
    up: "#26a69a",
    down: "#ef5350",
    light: { bg: "#ffffff", text: "#191919", grid: "#f0f3fa", border: "#e0e3eb", crosshair: "#9598a1" },
    dark: { bg: "#131722", text: "#d1d4dc", grid: "#1e222d", border: "#2a2e39", crosshair: "#758696" },
  };

  function layoutOptions(style) {
    if (style === "tradingview") {
      const t = isDark() ? TV.dark : TV.light;
      return {
        layout: { background: { type: LWC.ColorType.Solid, color: t.bg }, textColor: t.text },
        grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
        rightPriceScale: { borderColor: t.border },
        timeScale: { borderColor: t.border },
        crosshair: { vertLine: { color: t.crosshair, labelBackgroundColor: isDark() ? "#2a2e39" : "#131722" },
                     horzLine: { color: t.crosshair, labelBackgroundColor: isDark() ? "#2a2e39" : "#131722" } },
      };
    }
    const border = token("--border");
    return {
      layout: { background: { type: LWC.ColorType.Solid, color: token("--surface") }, textColor: token("--muted") },
      grid: { vertLines: { color: rgba(border, 0.55) }, horzLines: { color: rgba(border, 0.55) } },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border },
      crosshair: { vertLine: { color: token("--reference"), labelBackgroundColor: token("--primary-dark") },
                   horzLine: { color: token("--reference"), labelBackgroundColor: token("--primary-dark") } },
    };
  }

  function baseChart(container, extra = {}) {
    return LWC.createChart(container, {
      autoSize: true,
      layout: { fontFamily: "Inter, system-ui, sans-serif", fontSize: 12 },
      localization: { priceFormatter },
      crosshair: { mode: LWC.CrosshairMode.Normal },
      rightPriceScale: { scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 9, maxBarSpacing: 22 },
      ...extra,
    });
  }

  const live = new Set();
  window.addEventListener("mockfolio-theme-change", () => live.forEach((c) => c.applyTheme()));

  // ---- Stock chart: candles + volume, or MockFolio vs real price lines ----
  function createStockChart(container, { symbol, legend }) {
    const chart = baseChart(container);
    const watermark = LWC.createTextWatermark(chart.panes()[0], {
      horzAlign: "center",
      vertAlign: "center",
      lines: [{ text: symbol, fontSize: 56, fontStyle: "700" }],
    });
    let mode = "candles";
    let intervalLabel = "1m";
    let series = {};
    let data = { adjusted: [], raw: [] };
    let orders = [];
    let orderLines = [];

    // Pending limit / stop / target orders drawn as labelled price lines, like TradingView's order lines.
    function drawOrderLines() {
      orderLines.forEach(([s, line]) => s.removePriceLine(line));
      orderLines = [];
      const host = series.candles || series.mockfolio;
      if (!host) return;
      orders.forEach((o) => {
        const price = Number(o.order_type === "LIMIT" ? o.limit_price : o.trigger_price);
        if (!price) return;
        const isStop = o.order_type === "STOPLOSS";
        const title = o.parent_order_id ? (isStop ? `SL ${o.quantity}` : `TGT ${o.quantity}`) : `${o.side} ${o.order_type === "LIMIT" ? "LMT" : "STP"} ${o.quantity}`;
        const color = o.parent_order_id ? (isStop ? TV.down : TV.up) : o.side === "BUY" ? "#2962ff" : "#ff9800";
        orderLines.push([host, host.createPriceLine({ price, color, lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title })]);
      });
    }

    const candleOpts = () => ({
      upColor: TV.up, downColor: TV.down, borderVisible: false, wickUpColor: TV.up, wickDownColor: TV.down,
    });
    const volumeColor = (c) => rgba(c.close >= c.open ? TV.up : TV.down, 0.45);

    function build() {
      Object.values(series).forEach((s) => chart.removeSeries(s));
      series = {};
      orderLines = [];
      if (mode === "candles") {
        series.candles = chart.addSeries(LWC.CandlestickSeries, candleOpts());
        series.volume = chart.addSeries(LWC.HistogramSeries, {
          priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false, priceLineVisible: false,
        });
        series.volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      } else {
        series.real = chart.addSeries(LWC.LineSeries, {
          color: token("--chart-4"), lineWidth: 2, title: "Real", priceLineVisible: false,
        });
        series.mockfolio = chart.addSeries(LWC.AreaSeries, {
          lineColor: token("--primary"), lineWidth: 2.5, title: "MockFolio",
          topColor: rgba(token("--primary"), 0.22), bottomColor: rgba(token("--primary"), 0),
        });
      }
      applyTheme();
      fill();
      drawOrderLines();
    }

    const candleBar = (c) => ({ time: toTime(c.bucket_start), open: +c.open, high: +c.high, low: +c.low, close: +c.close });
    const volBar = (c) => ({ time: toTime(c.bucket_start), value: +c.volume, color: volumeColor(c) });
    const point = (c) => ({ time: toTime(c.bucket_start), value: +c.close });

    function fill() {
      if (mode === "candles") {
        series.candles.setData(data.adjusted.map(candleBar));
        series.volume.setData(data.adjusted.map(volBar));
      } else {
        series.mockfolio.setData(data.adjusted.map(point));
        series.real.setData(data.raw.map(point));
      }
      chart.timeScale().scrollToRealTime();
      showLegend();
    }

    function applyTheme() {
      chart.applyOptions(layoutOptions(mode === "candles" ? "tradingview" : "mockfolio"));
      const wm = mode === "candles" ? (isDark() ? "rgba(209,212,220,0.06)" : "rgba(19,23,34,0.05)") : rgba(token("--muted"), 0.09);
      watermark.applyOptions({ lines: [{ text: `${symbol} · ${intervalLabel}`, fontSize: 56, fontStyle: "700", color: wm }] });
      if (series.real) {
        series.real.applyOptions({ color: token("--chart-4") });
        series.mockfolio.applyOptions({
          lineColor: token("--primary"), topColor: rgba(token("--primary"), 0.22), bottomColor: rgba(token("--primary"), 0),
        });
      }
    }

    // TradingView-style OHLC legend that follows the crosshair.
    function showLegend(param) {
      if (!legend) return;
      const at = (s, list) => (param?.time && s ? param.seriesData.get(s) : null) || list[list.length - 1];
      if (mode === "candles") {
        const c = param?.time ? param.seriesData.get(series.candles) : null;
        const src = c || (data.adjusted.length ? candleBar(data.adjusted[data.adjusted.length - 1]) : null);
        if (!src) return (legend.innerHTML = "");
        const v = param?.time ? param.seriesData.get(series.volume)?.value : +data.adjusted[data.adjusted.length - 1]?.volume;
        const chg = src.open ? ((src.close - src.open) / src.open) * 100 : 0;
        const cls = src.close >= src.open ? "up" : "down";
        legend.innerHTML =
          `<span class="tv-legend-title">${symbol} · ${intervalLabel} · MockFolio</span>` +
          `<span class="tv-ohlc ${cls}"><i>O</i>${inr.format(src.open)} <i>H</i>${inr.format(src.high)} <i>L</i>${inr.format(src.low)} <i>C</i>${inr.format(src.close)} <b>${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</b></span>` +
          `<span class="tv-vol"><i>Vol</i>${Number(v || 0).toLocaleString("en-IN")}</span>`;
      } else {
        const m = at(series.mockfolio, data.adjusted.map(point));
        const r = at(series.real, data.raw.map(point));
        if (!m) return (legend.innerHTML = "");
        const gap = r?.value ? ((m.value - r.value) / r.value) * 100 : 0;
        legend.innerHTML =
          `<span class="tv-legend-title">${symbol} · ${intervalLabel}</span>` +
          `<span class="tv-line mf"><i></i>MockFolio ${priceFormatter(m.value)}</span>` +
          (r ? `<span class="tv-line real"><i></i>Real ${priceFormatter(r.value)}</span>` : "") +
          `<span class="tv-gap">Gap <b>${gap >= 0 ? "+" : ""}${gap.toFixed(2)}%</b></span>`;
      }
    }
    chart.subscribeCrosshairMove(showLegend);

    const api = {
      setMode(next) {
        if (next !== mode) {
          mode = next;
          build();
        }
      },
      setData(adjusted, raw, label) {
        data = { adjusted, raw };
        intervalLabel = label;
        applyTheme();
        fill();
        // Sparse history fills the pane; long history keeps TradingView's bar width.
        if (adjusted.length < 90) chart.timeScale().fitContent();
      },
      // Live tail: replace/append the newest bars without resetting the view.
      update(adjustedTail, rawTail) {
        const merge = (list, tail) => {
          tail.forEach((c) => {
            const last = list[list.length - 1];
            if (last && last.bucket_start === c.bucket_start) list[list.length - 1] = c;
            else if (!last || c.bucket_start > last.bucket_start) list.push(c);
          });
        };
        merge(data.adjusted, adjustedTail);
        merge(data.raw, rawTail);
        if (mode === "candles") {
          adjustedTail.forEach((c) => {
            series.candles.update(candleBar(c));
            series.volume.update(volBar(c));
          });
        } else {
          adjustedTail.forEach((c) => series.mockfolio.update(point(c)));
          rawTail.forEach((c) => series.real.update(point(c)));
        }
        showLegend();
      },
      setOrderLines(list) {
        orders = list;
        drawOrderLines();
      },
      applyTheme,
      get mode() {
        return mode;
      },
    };
    build();
    live.add(api);
    return api;
  }

  // ---- Portfolio value: baseline at starting cash, green above / red below ----
  function createValueChart(container, { baseline }) {
    const chart = baseChart(container, {
      handleScroll: false,
      handleScale: false,
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 1 },
    });
    const s = chart.addSeries(LWC.BaselineSeries, {
      baseValue: { type: "price", price: baseline },
      lineWidth: 2,
      // Keep the starting-cash line in view so above/below reads at a glance.
      autoscaleInfoProvider: (original) => {
        const r = original();
        if (!r) return r;
        return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, baseline), maxValue: Math.max(r.priceRange.maxValue, baseline) } };
      },
    });
    const baseLine = s.createPriceLine({ price: baseline, lineStyle: LWC.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "Start" });
    function applyTheme() {
      chart.applyOptions(layoutOptions("mockfolio"));
      const pos = token("--positive");
      const neg = token("--negative");
      s.applyOptions({
        topLineColor: pos, topFillColor1: rgba(pos, 0.28), topFillColor2: rgba(pos, 0.02),
        bottomLineColor: neg, bottomFillColor1: rgba(neg, 0.02), bottomFillColor2: rgba(neg, 0.28),
      });
      baseLine.applyOptions({ color: token("--reference") });
    }
    const api = {
      element: container.firstElementChild,
      setData(points) {
        const rows = points.map((p) => ({ time: toTime(p.time), value: +p.value }));
        s.setData(rows.filter((p, i) => i === 0 || p.time > rows[i - 1].time));
        chart.timeScale().fitContent();
      },
      applyTheme,
    };
    applyTheme();
    live.add(api);
    return api;
  }

  window.MockfolioCharts = { createStockChart, createValueChart };
})();
