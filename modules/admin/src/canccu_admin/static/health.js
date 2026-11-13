// The Health page follows the watch's checks (every 10 s, health.py) without a reload: while the
// tab is in view it reads the page again and swaps only the parts marked data-canccu-live (the
// tiles, the parts table and "Last check") and the menu's Health item, whose note ("1 down") the
// shell draws from the same check; scroll stays where it is and an open "What to check" stays open,
// by part. It reads without "?check=now", so an open page never makes admin
// check more often than the watch does. Hidden, it pauses; back in view, it reads at once.
const EVERY_MS = 10000;
const LIVE = "[data-canccu-live]";
const WAY = "details[data-canccu-part]";
// The shell's one menu is both the desktop menu and the phone's More sheet (canccu_kit.ui._menu).
const NOTE_HOST = 'a.canccu-menu__item[href$="/health-view"]';
let timer;
let reading = false;

// Swapping a part someone is selecting text in would drop the selection: wait for the next tick.
function selecting() {
  const sel = getSelection();
  if (!sel || sel.isCollapsed) return false;
  return [...document.querySelectorAll(LIVE)].some((part) =>
    sel.containsNode(part, true),
  );
}

function swap(next) {
  const open = new Set(
    [...document.querySelectorAll(`${WAY}[open]`)].map(
      (way) => way.dataset.canccuPart,
    ),
  );
  const focused =
    document.activeElement?.closest(WAY)?.dataset.canccuPart ?? null;
  for (const part of document.querySelectorAll(LIVE)) {
    const fresh = next.querySelector(
      `[data-canccu-live="${part.dataset.canccuLive}"]`,
    );
    if (fresh) part.replaceWith(document.adoptNode(fresh));
  }
  const fresh = next.querySelectorAll(NOTE_HOST);
  document.querySelectorAll(NOTE_HOST).forEach((item, i) => {
    if (!fresh[i]) return;
    const had = document.activeElement === item;
    const swapped = document.adoptNode(fresh[i]);
    item.replaceWith(swapped);
    if (had) swapped.focus({ preventScroll: true });
  });
  for (const way of document.querySelectorAll(WAY))
    if (open.has(way.dataset.canccuPart)) way.open = true;
  if (focused !== null)
    document
      .querySelector(
        `${WAY}[data-canccu-part="${CSS.escape(focused)}"] > summary`,
      )
      ?.focus({ preventScroll: true });
}

async function tick() {
  if (reading || document.visibilityState !== "visible") return;
  reading = true;
  try {
    const res = await fetch(location.pathname);
    // Signed out (sent on to sign-in) or refused: keep the last check; the next page says why.
    if (!res.ok || res.redirected) return;
    const next = new DOMParser().parseFromString(await res.text(), "text/html");
    if (!selecting()) swap(next);
  } catch {
    // Nothing answered: the last check stays on screen, with its time.
  } finally {
    reading = false;
  }
}

function follow() {
  clearInterval(timer);
  if (document.visibilityState === "visible")
    timer = setInterval(tick, EVERY_MS);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") tick();
  follow();
});
follow();
