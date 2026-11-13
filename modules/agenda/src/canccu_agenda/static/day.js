// The run of show (docs/design/mockups.html, sheet 5). Without this script the page still works:
// the day switch jumps, Jump to now and the strip's Now link go to the now line, the filter has
// its button, focus shows a gap's line and every day ends with its own add row. With it:
// - the day switch follows the scroll, and the page opens at the now line;
// - on a phone, a strip keeps what is on now in view once the hero has scrolled away;
// - the audience filter applies on a change;
// - a finger has no hover, so a long press near the line between two items shows that gap's
//   "Add between" line, and the bar's Quick add starts from the gap in view.
const list = document.querySelector(".canccu-agenda-list");
const bar = document.querySelector(".canccu-tabbar__add");
// With no gap or add row in view the bar goes back to its own link (Quick add "Now").
const home = bar && bar.href;
const HOLD_MS = 450;
const SLOP_PX = 10; // a finger that moves this far is scrolling, not pressing

if (list && list.querySelector(".canccu-agenda-gap, .canccu-agenda-addrow")) {
  const gaps = [...list.querySelectorAll(".canccu-agenda-gap")];
  const adds = [...list.querySelectorAll(".canccu-agenda-gap a, .canccu-agenda-addrow a")];
  let timer = 0;
  let start = null;
  let shown = null;
  // A long press that showed a line swallows the click and the menu that follow it, so the row
  // under the finger does not open.
  let held = false;

  const nearest = (y) => {
    let best = null;
    for (const gap of gaps) {
      const d = Math.abs(gap.getBoundingClientRect().top - y);
      if (!best || d < best.d) best = { gap, d };
    }
    return best && best.gap;
  };

  const show = (gap) => {
    if (shown) shown.classList.remove("is-shown");
    shown = gap;
    gap.classList.add("is-shown");
    follow();
  };

  const stop = () => {
    clearTimeout(timer);
    timer = 0;
  };

  list.addEventListener("pointerdown", (e) => {
    held = false;
    if (e.pointerType !== "touch" || !gaps.length) return;
    start = { x: e.clientX, y: e.clientY };
    stop();
    timer = setTimeout(() => {
      timer = 0;
      const gap = nearest(start.y);
      if (gap) {
        held = true;
        show(gap);
      }
    }, HOLD_MS);
  });
  list.addEventListener("pointermove", (e) => {
    if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP_PX) stop();
  });
  for (const type of ["pointerup", "pointercancel"]) list.addEventListener(type, stop);
  list.addEventListener("contextmenu", (e) => {
    if (held || timer) e.preventDefault();
  });
  list.addEventListener(
    "click",
    (e) => {
      if (!held) return;
      held = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  // The bar's Quick add opens at the line a long press showed while it is in view, else at the
  // first gap (or the day's add row) in view, else at its own link.
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  };
  const follow = () => {
    if (!bar) return;
    const own = shown && shown.querySelector("a");
    const target = own && inView(own) ? own : adds.find(inView);
    bar.href = target ? target.href : home;
  };
  let queued = false;
  document.addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        follow();
      });
    },
    { capture: true, passive: true },
  );
  follow();
}

const days = [...document.querySelectorAll(".canccu-agenda-days a")];
const lines = [...document.querySelectorAll(".canccu-agenda-dayline")];
// The day whose line has passed under the top of the window is the day in view.
const markDay = () => {
  let inView = lines[0];
  for (const line of lines) if (line.getBoundingClientRect().top <= 64) inView = line;
  if (!inView) return;
  for (const link of days) {
    if (link.hash === `#${inView.id}`) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
};

const strip = document.querySelector(".canccu-agenda-strip");
const hero = document.querySelector(".canccu-agenda-hero");
if (strip && hero) {
  new IntersectionObserver(([entry]) => {
    strip.classList.toggle("is-shown", !entry.isIntersecting);
  }).observe(hero);
}

const filter = document.querySelector(".canccu-agenda-filter");
if (filter) {
  filter.classList.add("is-live");
  filter.querySelector("select").addEventListener("change", () => filter.submit());
}

// A plain visit opens at what is on now; an address with a query or a target (a picked item, a
// notice after a change) keeps its own place.
const nowLine = document.getElementById("now");
if (nowLine && !location.search && !location.hash) nowLine.scrollIntoView({ block: "center" });

if (lines.length) {
  let pending = false;
  document.addEventListener(
    "scroll",
    () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        markDay();
      });
    },
    { capture: true, passive: true },
  );
  markDay();
}
