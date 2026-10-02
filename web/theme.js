(() => {
  const storageKey = "pair-lab-inventory-theme";
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  function preferredTheme() {
    try {
      const savedTheme = window.localStorage.getItem(storageKey);
      if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
    } catch {
      // The theme still works when browser privacy settings disable local storage.
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    if (themeMeta) themeMeta.content = isDark ? "#0b1724" : "#123b5d";

    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const nextTheme = isDark ? "light" : "dark";
      button.setAttribute("aria-label", `Use ${nextTheme} mode`);
      button.setAttribute("title", `Use ${nextTheme} mode`);
      button.removeAttribute("aria-pressed");
    });
  }

  const initialTheme = preferredTheme();
  applyTheme(initialTheme);

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(document.documentElement.dataset.theme || initialTheme);
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        try {
          window.localStorage.setItem(storageKey, nextTheme);
        } catch {
          // Keep the selected theme for this page even if it cannot be persisted.
        }
        applyTheme(nextTheme);
      });
    });
  });
})();
