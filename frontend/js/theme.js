(() => {
  const key = "mockfolio-theme";
  const saved = localStorage.getItem(key);
  document.documentElement.dataset.theme = saved === "dark" ? "dark" : "light";
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
