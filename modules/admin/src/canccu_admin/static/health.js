// The Health page follows the watch's checks (every 10 s, health.py) without a reload: while the
// tab is in view it reads the page's live parts alone (/admin/health-view/live, never the whole
// page with its menu) and swaps each part marked data-canccu-live (the tiles, the parts table and
// "Last check"); scroll stays where it is and an open "What to check" stays open, by part. The
// menu's Health note follows the checks through shell.js, as on every organiser page. It reads
// without "?check=now", so an open page never makes admin check more often than the watch does.
// Hidden, it pauses; back in view, it reads at once.
const EVERY_MS = 10000;
const LIVE = "[data-canccu-live]";
const WAY = "details[data-canccu-part]";
const LIVE_PARTS = "/admin/health-view/live";
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
    const fresh = next.content.querySelector(
      `[data-canccu-live="${part.dataset.canccuLive}"]`,
    );
    if (fresh) part.replaceWith(document.adoptNode(fresh));
  }
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
    const res = await fetch(LIVE_PARTS);
    // Signed out (sent on to sign-in) or refused: keep the last check; the next page says why.
    if (!res.ok || res.redirected) return;
    const next = document.createElement("template");
    next.innerHTML = await res.text();
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
