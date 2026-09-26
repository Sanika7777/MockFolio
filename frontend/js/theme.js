(() => {
  const key = "mockfolio-theme";
  const saved = localStorage.getItem(key);
  const system = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  document.documentElement.dataset.theme = saved
    ? saved === "dark"
      ? "dark"
      : "light"
    : system;
  window.MockfolioTheme = {
    key,
    current: () => document.documentElement.dataset.theme,
    set(theme) {
      const value = theme === "dark" ? "dark" : "light";
      document.documentElement.dataset.theme = value;
      localStorage.setItem(key, value);
      window.dispatchEvent(
        new CustomEvent("mockfolio-theme-change", { detail: value }),
      );
    },
    toggle() {
      this.set(this.current() === "dark" ? "light" : "dark");
    },
  };
})();
