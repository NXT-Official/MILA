// Runs before hydration to avoid a light->dark flash. Must stay a static,
// external file (not an inline <script>) so it can run without 'unsafe-inline'
// in the CSP script-src. Keep the storage key in sync with
// src/constants/app.ts THEME_STORAGE_KEY.
(function () {
  try {
    var t = localStorage.getItem("mila-theme");
    if (t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.classList.add("dark");
    }
  } catch (e) {}
})();
