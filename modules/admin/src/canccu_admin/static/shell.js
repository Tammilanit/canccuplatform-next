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
// that ends that press is swallowed. Esc hides every shown tooltip until it is left, or until its
// trigger is clicked or pressed again.
const LONG_PRESS_MS = 500;
// A finger drifts a few pixels while it holds still; a scroll moves further and is no press.
const PRESS_SLOP_PX = 10;
// The click that ends a long press follows its pointerup at once; a press that ends without one
// (the browser's own long-press menu) must not swallow a later click.
const SWALLOW_MS = 400;
const OPEN = "canccu-tip--open";
const HUSHED = "canccu-tip--hushed";
const PLACED = "canccu-tip__text--placed";
// Triggers that act on a tap, so their tooltip waits for a long press.
const PRESSED = ".canccu-tip > .canccu-button--icon, .canccu-tip > .canccu-stepper__button";
const EDGE_PX = 8;
const GAP_PX = 6;
let pressTimer;
let pressFrom;
let swallowClick = false;

/** Fixed on the screen, above its trigger or below when there is no room, inside the screen's
 * edges: a card that clips its overflow (canccu-card--flush) never cuts it. */
function place(tip) {
  const text = tip.querySelector(":scope > .canccu-tip__text");
  if (!text) return;
  const at = tip.getBoundingClientRect();
  const { width, height } = text.getBoundingClientRect();
  const right = document.documentElement.clientWidth - EDGE_PX - width;
  const left = Math.max(EDGE_PX, Math.min(at.left + at.width / 2 - width / 2, right));
  const above = at.top - GAP_PX - height;
  text.classList.add(PLACED);
  text.style.left = `${left}px`;
  text.style.top = `${above >= EDGE_PX ? above : at.bottom + GAP_PX}px`;
}

function placeShown() {
  for (const tip of document.querySelectorAll(
    `.canccu-tip:hover, .canccu-tip:focus-within, .${OPEN}`,
  )) {
    place(tip);
  }
}

for (const name of ["pointerover", "focusin"]) {
  document.addEventListener(name, (e) => {
    const tip = e.target.closest?.(".canccu-tip");
    if (tip) place(tip);
  });
}
document.addEventListener("scroll", placeShown, { capture: true, passive: true });
window.addEventListener("resize", placeShown);

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
    if (tip) {
      place(tip);
      tip.classList.remove(HUSHED);
      tip.classList.toggle(OPEN);
    }
  },
  true,
);

document.addEventListener("pointerdown", (e) => {
  const button = e.target.closest?.(PRESSED);
  swallowClick = false;
  if (!button || e.pointerType !== "touch") return;
  clearTimeout(pressTimer);
  pressFrom = { x: e.clientX, y: e.clientY };
  pressTimer = setTimeout(() => {
    closeTips(button.parentElement);
    place(button.parentElement);
    button.parentElement.classList.remove(HUSHED);
    button.parentElement.classList.add(OPEN);
    swallowClick = true;
  }, LONG_PRESS_MS);
});
document.addEventListener("pointermove", (e) => {
  if (pressFrom && Math.hypot(e.clientX - pressFrom.x, e.clientY - pressFrom.y) > PRESS_SLOP_PX) {
    clearTimeout(pressTimer);
  }
});
for (const name of ["pointerup", "pointercancel"]) {
  document.addEventListener(name, () => {
    clearTimeout(pressTimer);
    pressFrom = undefined;
    if (swallowClick) setTimeout(() => (swallowClick = false), SWALLOW_MS);
  });
}
document.addEventListener("contextmenu", (e) => {
  if (e.target.closest?.(PRESSED)) e.preventDefault();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const shown = new Set(document.querySelectorAll(`.canccu-tip:hover, .${OPEN}`));
  const focused = document.activeElement?.closest?.(".canccu-tip");
  if (focused) shown.add(focused);
  closeTips();
  for (const tip of shown) tip.classList.add(HUSHED);
});
for (const name of ["focusout", "pointerleave"]) {
  document.addEventListener(
    name,
    (e) => e.target.closest?.(".canccu-tip")?.classList.remove(HUSHED),
    true,
  );
}
