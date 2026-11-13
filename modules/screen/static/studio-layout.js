/*
 * Zones and layouts' box editor (#405; v8 sheet 10, the lower frames), loaded by
 * static/studio-zone.js. It places every thumbnail and box on its grid (the CSP allows no inline
 * style), resizes the chosen box by its buttons or, with a fine pointer, its handles, hides and
 * shows boxes, resets them, and for Dashboard picks the hero's box. It shades the space an edit
 * left empty and fills it on request (#422). The geometry is studio-boxes.js; the zone page asks
 * this for the zone's box settings, their Changes lines and the gaps' warnings.
 */
import { drag, fill, gapWords, gaps, hide, resize, sameArea, show } from "./studio-boxes.js";

const place = (a) => `${a.row} / ${a.column} / span ${a.rows} / span ${a.columns}`;

export function boxEditor(form, { say, tell, changed }) {
  for (const g of document.querySelectorAll("[data-grid]")) {
    const [columns, rows] = g.dataset.grid.split(" ").map(Number);
    g.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    // On a phone a row keeps a tappable height (studio-layout.css), else the grid is to scale.
    g.style.gridTemplateRows = `repeat(${rows}, minmax(var(--canccu-studio-row, 0px), 1fr))`;
  }
  for (const el of document.querySelectorAll("[data-area]")) el.style.gridArea = el.dataset.area;

  const map = form.querySelector("[data-boxes]");
  const [columns, rows] = map.dataset.grid.split(" ").map(Number);
  const grid = { columns, rows };
  const original = JSON.parse(form.dataset.zone);
  const regionNames = JSON.parse(form.dataset.regionNames);
  const layoutNames = JSON.parse(form.dataset.layoutNames);
  const initial = [...map.querySelectorAll("[data-box]")].map((b) => ({
    id: b.dataset.pick,
    ...JSON.parse(b.dataset.box),
  }));
  let boxes = initial;
  const heroCard = form.querySelector("[data-hero-card]");
  let hero = original.hero_region;
  const layoutAreas = () => Object.fromEntries(boxes.map((b) => [b.id, b.layoutArea]));
  const by = (attr, id) => form.querySelectorAll(`[${attr}="${CSS.escape(id)}"]`);
  const nameOf = (id) => regionNames[id] ?? id;

  function shadeGaps() {
    for (const el of map.querySelectorAll("[data-gap]")) el.remove();
    for (const g of gaps(boxes, grid)) {
      const shade = document.createElement("i");
      shade.className = "canccu-studio-gap";
      shade.dataset.gap = "";
      shade.setAttribute("aria-hidden", "true");
      shade.style.gridArea = place(g.area);
      map.append(shade);
    }
  }
  function draw() {
    for (const b of boxes) {
      for (const el of [...by("data-pick", b.id), ...by("data-hero", b.id)]) {
        if (!el.dataset.area) continue;
        el.style.gridArea = place(b.area);
        el.hidden = b.hidden;
      }
      for (const el of by("data-show-box", b.id)) el.hidden = !b.hidden;
      const check = form.querySelector(`[data-region="${CSS.escape(b.id)}"] [data-box-hide]`);
      if (check) check.checked = b.hidden;
    }
    form.querySelector("[data-hidden-boxes]").hidden = !boxes.some((b) => b.hidden);
    shadeGaps();
    for (const el of form.querySelectorAll("[data-hero]"))
      el.setAttribute("aria-pressed", String(el.dataset.hero === (hero ?? "hero")));
    changed();
  }
  /** The next boxes, or the reason in the notice when the geometry said no (null). */
  function update(next, reason) {
    if (next === null) return tell(say(reason));
    boxes = next;
    draw();
  }
  const regionOf = (el) => el.closest("[data-region]")?.dataset.region;

  form.addEventListener("click", (event) => {
    const size = event.target.closest("[data-size]");
    const again = event.target.closest("[data-show-box]");
    const role = event.target.closest("[data-hero]");
    const gap = event.target.closest("[data-fill-gap]");
    if (gap) update(fill(boxes, gaps(boxes, grid)[Number(gap.dataset.fillGap)]), "box.blocked");
    else if (size) update(resize(boxes, regionOf(size), size.dataset.size, grid), "box.blocked");
    else if (again) {
      update(show(boxes, again.dataset.showBox, layoutAreas(), grid), "box.show_blocked");
      if (!boxes.find((b) => b.id === again.dataset.showBox)?.hidden)
        by("data-pick", again.dataset.showBox)[0]?.click();
    } else if (role) {
      hero = role.dataset.hero === "hero" ? null : role.dataset.hero;
      draw();
    } else if (event.target.closest("[data-boxes-reset]")) {
      if (!window.confirm(say("boxes.reset_confirm"))) return;
      update(boxes.map((b) => ({ ...b, area: b.layoutArea, hidden: false })));
    }
  });
  form.addEventListener("change", (event) => {
    const check = event.target.closest("[data-box-hide]");
    if (!check) return;
    const id = regionOf(check);
    if (check.checked) update(hide(boxes, id));
    else {
      update(show(boxes, id, layoutAreas(), grid), "box.show_blocked");
      check.checked = boxes.find((b) => b.id === id)?.hidden ?? false;
    }
  });
  // A handle moves its edge to the grid line under the pointer, measured from the drag's start so
  // a stop at a neighbour does not stick once the pointer comes back.
  map.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-edge]");
    if (!handle) return;
    event.preventDefault();
    const id = handle.closest("[data-pick]").dataset.pick;
    const edge = handle.dataset.edge;
    const start = boxes;
    const rect = map.getBoundingClientRect();
    const across = edge === "left" || edge === "right";
    const move = (e) => {
      const at = across
        ? ((e.clientX - rect.left) / rect.width) * columns
        : ((e.clientY - rect.top) / rect.height) * rows;
      boxes = drag(start, id, edge, Math.round(at) + 1, grid);
      draw();
    };
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", () => handle.removeEventListener("pointermove", move), {
      once: true,
    });
  });
  // A zone may be saved with a gap, and its warning shows from load. Not draw(): it calls
  // changed(), and the zone page has no editor to ask until this returns.
  shadeGaps();

  return {
    /** The zone's box settings: a box at the layout's area or shown sets nothing. */
    apply(z) {
      z.layout_id = form.dataset.layout || null;
      for (const [id, s] of Object.entries(z.regions)) {
        delete s.area;
        delete s.hidden;
        if (Object.keys(s).length === 0) Reflect.deleteProperty(z.regions, id);
      }
      for (const b of boxes) {
        const s = { ...(z.regions[b.id] || {}) };
        if (b.hidden) s.hidden = true;
        else if (!sameArea(b.area, b.layoutArea)) s.area = b.area;
        if (Object.keys(s).length > 0) z.regions[b.id] = s;
      }
      if (heroCard) z.hero_region = hero;
      const grow = form.elements.grow_for_showcase;
      if (grow) z.grow_for_showcase = grow.checked;
    },
    /** The Changes lines: the layout, then each box against what the page drew. */
    changes() {
      const lines = [];
      const [was, now] = [original.layout_id ?? "", form.dataset.layout];
      if (was !== now) {
        const name = (id) => layoutNames[id] ?? id;
        lines.push(say("change.layout", { from: name(was), to: name(now) }));
      }
      for (const b of boxes) {
        const a = initial.find((i) => i.id === b.id);
        const box = nameOf(b.id);
        if (b.hidden !== a.hidden)
          lines.push(say(b.hidden ? "change.hidden" : "change.shown", { box }));
        else if (!b.hidden && !sameArea(b.area, a.area)) lines.push(say("change.size", { box }));
      }
      if (heroCard && hero !== original.hero_region)
        lines.push(
          say("change.hero", {
            from: nameOf(original.hero_region ?? "hero"),
            to: nameOf(hero ?? "hero"),
          }),
        );
      return lines;
    },
    /** A warning per gap, by the box beside it, and whether Fill the gap can close it. */
    gaps() {
      return gaps(boxes, grid).map((g) => {
        const { key, count } = gapWords(g);
        return { text: say(key, { count, box: nameOf(g.box) }), fills: g.fills };
      });
    },
  };
}
