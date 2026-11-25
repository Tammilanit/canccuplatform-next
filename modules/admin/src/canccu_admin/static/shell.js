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
// One read at a time: two open at once could answer out of order and draw the older note.
let noteReading = false;
let noteAgain = false;

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
  if (!item || noteReading || document.visibilityState !== "visible") return;
  noteReading = true;
  try {
    const res = await fetch("/api/admin/health/note");
    // Signed out or refused: keep what the page has; its next load says why.
    if (res.ok) drawNote(item, await res.json());
  } catch {
    // Admin didn't answer: the last note stays.
  } finally {
    noteReading = false;
    if (noteAgain) {
      noteAgain = false;
      readNote();
    }
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
// The Health page swapped in a newer check (health.js): the note follows at once, or right after
// a read that is open, since that one may answer with the older check.
document.addEventListener("canccu-health-swapped", () => {
  if (noteReading) noteAgain = true;
  else readNote();
});
followNote();

// Tooltips (#782, packages/ui tip.ts): ui.css shows them on hover and keyboard focus. A phone has
// neither, so a tap on an info button or a chip opens its tooltip and a tap elsewhere closes it;
// an icon button acts on a tap, so only a press of LONG_PRESS_MS shows its tooltip, and the click
// that ends that press is swallowed. Esc hides an open or focused tooltip until it is left.
const LONG_PRESS_MS = 500;
const OPEN = "canccu-tip--open";
const HUSHED = "canccu-tip--hushed";
let pressTimer;
let swallowClick = false;

function closeTips(except) {
  for (const tip of document.querySelectorAll(`.${OPEN}`)) {
    if (tip !== except) tip.classList.remove(OPEN);
  }
}

document.addEventListener(
  "click",
  (e) => {
    if (swallowClick) {
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const trigger = e.target.closest?.(".canccu-tip > .canccu-tip__info, .canccu-tip > .canccu-badge");
    const tip = trigger?.parentElement;
    closeTips(tip);
    if (tip) tip.classList.toggle(OPEN);
  },
  true,
);

document.addEventListener("pointerdown", (e) => {
  const button = e.target.closest?.(".canccu-tip > .canccu-button--icon");
  swallowClick = false;
  if (!button || e.pointerType !== "touch") return;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    closeTips(button.parentElement);
    button.parentElement.classList.add(OPEN);
    swallowClick = true;
  }, LONG_PRESS_MS);
});
for (const name of ["pointerup", "pointercancel", "pointermove"]) {
  document.addEventListener(name, () => clearTimeout(pressTimer));
}
document.addEventListener("contextmenu", (e) => {
  if (e.target.closest?.(".canccu-tip > .canccu-button--icon")) e.preventDefault();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeTips();
  const tip = document.activeElement?.closest?.(".canccu-tip");
  if (tip) tip.classList.add(HUSHED);
});
for (const name of ["focusout", "pointerleave"]) {
  document.addEventListener(
    name,
    (e) => e.target.closest?.(".canccu-tip")?.classList.remove(HUSHED),
    true,
  );
}
