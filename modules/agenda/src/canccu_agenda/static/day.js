// The run of show on a phone (docs/design/mockups.html, sheet 5, "Adding an item where it goes").
// A finger has no hover, so a long press near the line between two items shows that gap's
// "Add between" line, and the bar's Quick add starts from the gap in view. Without this script
// the page still works: focus shows a gap's line and every day ends with its own add row.
const list = document.querySelector(".canccu-agenda-list");
const bar = document.querySelector(".canccu-tabbar__add");
// With no gap or add row in view the bar goes back to its own link (Quick add "Now").
const home = bar && bar.href;
const HOLD_MS = 450;
const SLOP_PX = 10; // a finger that moves this far is scrolling, not pressing

if (list) {
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
