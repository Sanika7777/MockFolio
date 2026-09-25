(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const reduced = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Password show/hide toggles. Each button controls the input named in
  // its data-toggle-password attribute.
  $$("[data-toggle-password]").forEach((button) => {
    const input = document.getElementById(button.dataset.togglePassword);
    if (!input) return;
    button.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      button.setAttribute("aria-pressed", String(!showing));
      button.setAttribute(
        "aria-label",
        showing ? "Show password" : "Hide password",
      );
    });
  });

  // Password strength meter (register page only). Cosmetic: the real rule
  // stays "min 6 characters", enforced by auth.js and the server.
  const strengthInput = $("#password");
  const strengthMeter = $("#password-strength-meter");
  const strengthLabel = $("#password-strength");
  if (strengthMeter && strengthLabel && $("#register")) {
    const labels = ["", "Weak", "Fair", "Good strength", "Strong"];
    strengthInput.addEventListener("input", () => {
      const value = strengthInput.value;
      let score = 0;
      if (value.length >= 6) score++;
      if (value.length >= 10) score++;
      if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
      if (/\d/.test(value)) score++;
      if (/[^A-Za-z0-9]/.test(value)) score++;
      score = value ? Math.min(4, score) : 0;
      strengthMeter.dataset.score = String(score);
      strengthLabel.textContent = value ? labels[score] : "";
    });
  }

  // Headline count-up (register page only): ₹0 -> ₹1,00,000.
  const counter = $("#cash-counter");
  if (counter) {
    const target = Number(counter.dataset.target || 0);
    const format = (value) =>
      `₹${Math.round(value).toLocaleString("en-IN")}`;
    if (reduced()) {
      counter.textContent = format(target);
    } else {
      const duration = 900;
      const start = performance.now();
      const tick = (now) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        counter.textContent = format(target * eased);
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  // Brief shake on the card when a new error message appears.
  const errorRegion = $("#error");
  const card = $(".auth-card");
  if (errorRegion && card) {
    let last = "";
    new MutationObserver(() => {
      const text = errorRegion.textContent.trim();
      if (text && text !== last) {
        card.classList.remove("shake");
        // Force reflow so the animation can restart on repeated errors.
        void card.offsetWidth;
        card.classList.add("shake");
      }
      last = text;
    }).observe(errorRegion, { childList: true, characterData: true, subtree: true });
  }

  // Hero chart: start the traveling dot along the actual line path (SMIL
  // <animateMotion> keeps it locked to the path's own coordinate space, so
  // it can't drift outside the chart the way a CSS offset-path transform
  // can once the SVG is scaled by its container).
  const heroCharts = $$(".hero-chart");
  if (heroCharts.length) {
    const dots = heroCharts.flatMap((svg) => [
      ...svg.querySelectorAll(".line-dot"),
    ]);
    if (reduced()) {
      // No animation: park each dot at the line's start instead of
      // leaving it at its unset (0, 0) default.
      dots.forEach((dot) => {
        dot.setAttribute("cx", "6");
        dot.setAttribute("cy", "100");
      });
    } else {
      heroCharts.forEach((svg) => {
        svg.querySelectorAll("animateMotion").forEach((motion) => {
          try {
            motion.beginElement();
          } catch {
            // SMIL beginElement isn't supported in every browser; fall
            // back to the dot sitting at the path's start.
          }
        });
      });
      // Pause the loop while the tab is hidden rather than animating unseen.
      const setPaused = () => {
        const hidden = document.visibilityState === "hidden";
        heroCharts.forEach((svg) => {
          if (hidden) svg.pauseAnimations?.();
          else svg.unpauseAnimations?.();
        });
      };
      document.addEventListener("visibilitychange", setPaused);
    }
  }
})();
