(() => {
  const API_BASE = "http://127.0.0.1:8000";
  const formatINR = (value) => {
    const amount = Number(value || 0);
    return `${amount < 0 ? "-" : ""}₹${Math.abs(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const getErrorMessage = (payload, status, isAuthRequest = false) => {
    const detail =
      typeof payload?.detail === "string" ? payload.detail.toLowerCase() : "";
    if (status === 401 && !isAuthRequest)
      return "Your session has expired. Please sign in again.";
    if (status === 401 && isAuthRequest)
      return "The username or password is incorrect.";
    if (status === 403) return "You do not have permission to do that.";
    if (status === 404) return "We could not find that item.";
    if (detail.includes("insufficient cash"))
      return "You do not have enough cash for this trade.";
    if (detail.includes("insufficient shares"))
      return "You do not own enough shares to sell.";
    if (detail.includes("quantity"))
      return "Enter a quantity greater than zero.";
    if (detail.includes("already exists"))
      return "That username or email is already registered.";
    if (detail.includes("invalid username"))
      return "The username or password is incorrect.";
    return typeof payload?.detail === "string"
      ? payload.detail
      : `Request failed (${status}).`;
  };
  async function request(path, options = {}) {
    const headers = {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    };
    if (options.auth !== false) {
      const token = localStorage.getItem("token");
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    } catch {
      throw new Error("The MockFolio server is unavailable. Please try again.");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem("token");
        if (options.auth !== false && !location.pathname.endsWith("login.html"))
          location.href = "login.html";
      }
      const error = new Error(
        getErrorMessage(payload, response.status, options.auth === false),
      );
      error.status = response.status;
      throw error;
    }
    return payload;
  }
  window.MockfolioApi = {
    API_BASE,
    formatINR,
    getErrorMessage,
    login: (data) =>
      request("/auth/login", {
        method: "POST",
        body: JSON.stringify(data),
        auth: false,
      }),
    register: (data) =>
      request("/auth/register", {
        method: "POST",
        body: JSON.stringify(data),
        auth: false,
      }),
    me: () => request("/auth/me"),
    stocks: () => request("/stocks"),
    stock: (id) => request(`/stocks/${id}`),
    history: (id) => request(`/stocks/${id}/history`),
    portfolio: () => request("/portfolio"),
    summary: () => request("/portfolio/summary"),
    orders: () => request("/orders"),
    trades: () => request("/trades"),
    watchlist: () => request("/watchlist"),
    addWatchlist: (id) => request(`/watchlist/${id}`, { method: "POST" }),
    removeWatchlist: (id) => request(`/watchlist/${id}`, { method: "DELETE" }),
    trade: (side, data) =>
      request(`/trades/${side.toLowerCase()}`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    resetMarket: () => request("/admin/reset-market", { method: "POST" }),
    resetUser: (id) => request(`/admin/reset-user/${id}`, { method: "POST" }),
    adminUsers: () => request("/admin/users"),
    adminSummary: () => request("/admin/summary"),
    adminUser: (id) => request(`/admin/users/${id}`),
    adminUserTrades: (id) => request(`/admin/users/${id}/trades`),
    adminUserOrders: (id) => request(`/admin/users/${id}/orders`),
  };
})();
