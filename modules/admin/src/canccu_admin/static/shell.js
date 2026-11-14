// Loaded by every signed-in organiser page (canccu_kit.ui, packages/ui shell.ts): registers
// admin's service worker for the offline page, and on that page reloads once the phone is back
// online ("It loads by itself", sheet 8). It also keeps the menu's Health note ("Health 1 down",
// sheet 2) on every module's shell, from admin's note (contracts/admin.md, Health note): only
// admin knows the checks, and the other modules' pages are drawn without them.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/admin/static/sw.js", { scope: "/" })
    .catch(() => undefined);
}
if (document.querySelector("[data-canccu-offline]")) {
  window.addEventListener("online", () => window.location.reload());
}

// The watch checks every 10 s (admin's health.py); the note follows at the same pace.
const NOTE_EVERY_MS = 10000;
// The shell's one menu is both the desktop menu and the phone's More sheet; the item is there
// only for someone who may open Health, so no one else ever asks.
const HEALTH_ITEM = 'a.canccu-menu__item[href="/admin/health-view"]';
const NOTE_STATUSES = new Set(["degraded", "down"]);
let noteTimer;

function drawNote(item, { status, text }) {
  item.querySelector(".canccu-badge")?.remove();
  if (!text || !NOTE_STATUSES.has(status)) return;
  const badge = document.createElement("span");
  badge.className = `canccu-badge canccu-badge--${status}`;
  badge.textContent = text;
  item.append(badge);
}

async function readNote() {
  const item = document.querySelector(HEALTH_ITEM);
  if (!item || document.visibilityState !== "visible") return;
  try {
    const res = await fetch("/api/admin/health/note");
    // Signed out or refused: keep what the page has; its next load says why.
    if (res.ok) drawNote(item, await res.json());
  } catch {
    // Admin didn't answer: the last note stays.
  }
}

function followNote() {
  clearInterval(noteTimer);
  if (!document.querySelector(HEALTH_ITEM)) return;
  if (document.visibilityState === "visible") {
    readNote();
    noteTimer = setInterval(readNote, NOTE_EVERY_MS);
  }
}

document.addEventListener("visibilitychange", followNote);
followNote();
