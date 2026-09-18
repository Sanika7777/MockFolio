(() => {
  const form = document.querySelector("form");
  const error = document.querySelector("#error");
  const button = form?.querySelector("button");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    const data = Object.fromEntries(new FormData(form));
    if (form.id === "register" && data.password !== data.confirm_password) {
      error.textContent = "Passwords do not match.";
      return;
    }
    if (form.id === "register" && data.password.length < 6) {
      error.textContent = "Use at least 6 characters for your password.";
      return;
    }
    delete data.confirm_password;
    button.disabled = true;
    button.textContent =
      form.id === "register" ? "Creating account..." : "Signing in...";
    try {
      const result =
        form.id === "register"
          ? await MockfolioApi.register(data)
          : await MockfolioApi.login(data);
      localStorage.setItem("token", result.access_token);
      location.href = "index.html";
    } catch (requestError) {
      error.textContent = requestError.message;
      button.disabled = false;
      button.textContent =
        form.id === "register" ? "Start with ₹1,00,000" : "Sign in";
    }
  });
})();
