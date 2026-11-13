// Loaded by every signed-in organiser page (canccu_kit.ui, packages/ui shell.ts): registers
// admin's service worker for the offline page, and on that page reloads once the phone is back
// online ("It loads by itself", sheet 8).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/admin/static/sw.js", { scope: "/" }).catch(() => undefined);
}
if (document.querySelector("[data-canccu-offline]")) {
  window.addEventListener("online", () => window.location.reload());
}
