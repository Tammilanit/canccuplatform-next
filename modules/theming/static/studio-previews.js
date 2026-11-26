/*
 * The brand kit's previews (plan issue-185 D9, D10): each scaled to its box, the screen given the
 * draft, and Publish held until every preview shows this draft version. The screen preview gates
 * Publish, so it must show what Publish will show (#551).
 */
"use strict";

(() => {
  /* Each preview is a page at its own size, scaled to its box's width. */
  const scaled = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const width = parseFloat(getComputedStyle(target).getPropertyValue("--canccu-studio-w"));
      if (width > 0) target.style.setProperty("--canccu-studio-scale", target.clientWidth / width);
    }
  });
  for (const box of document.querySelectorAll(".canccu-studio-preview__box")) scaled.observe(box);

  /*
   * The screen preview is screen's virtual screen of one of the event's zones: the real player and
   * layout with the zone's real content (contracts/screen.md, A zone for a session). The page reads
   * the zone's state with this session, gives it the draft's look and posts it to the frame, which
   * draws a posted state instead of the live zone and answers that it drew it. Where the zones
   * cannot be read (no right to see the event's screens, or no screen module), the Studio's own
   * sample screen stands in.
   */
  const screenFrame = document.querySelector("iframe[data-screen-preview]");
  const PREVIEW_MESSAGE = "canccu-screen-preview";
  const DRAWN_MESSAGE = "canccu-screen-preview-drawn";
  /*
   * How long the player may take to answer before the sample screen stands in: one that refused
   * the state, or a pinned bundle from before the answer, would otherwise hold Publish for good.
   */
  const ANSWER_MS = 8000;
  let unanswered;
  let screenShown = false;
  // Only the answer to the last state posted counts: an earlier zone's may still come in.
  let posts = 0;
  let awaited;
  let zonePicks = 0;
  let onScreenLoad;
  /** The zone's state the screen frame draws, so a save posts it again without a reload. */
  let zoneState;
  /** Frames sent to a newer version that have not loaded it yet. */
  const loading = new Set();

  async function readJson(url) {
    const res = await fetch(url, { credentials: "same-origin" }).catch(() => undefined);
    return res?.ok ? res.json().catch(() => undefined) : undefined;
  }

  const sameArea = (a, b) =>
    a !== undefined &&
    b !== undefined &&
    a.column === b.column &&
    a.row === b.row &&
    a.columns === b.columns &&
    a.rows === b.rows;
  const fits = (a, grid) =>
    a.column + a.columns - 1 <= grid.columns && a.row + a.rows - 1 <= grid.rows;

  /** A region's columns from left to right, as screen splits it (compose/parts.ts `columnsOf`). */
  function columnsOf(area, parts) {
    const base = Math.floor(area.columns / parts);
    const extra = area.columns % parts;
    let column = area.column;
    return Array.from({ length: parts }, (_, i) => {
      const columns = base + (i < extra ? 1 : 0);
      const part = { ...area, column, columns };
      column += columns;
      return part;
    });
  }

  /** Parts too many for their region's columns: screen then draws the region whole. */
  function whole(parts, area, layer) {
    let offset = 0;
    const order = parts.flatMap((p) => {
      const mine = p.order.map((i) => i + offset);
      offset += p.widgets.length;
      return mine;
    });
    return { ...parts[0], area, layer, widgets: parts.flatMap((p) => p.widgets), order };
  }

  /*
   * A layout box as the zone draws it, whole or as parts side by side (`<id>`, `<id>-2`, …,
   * contracts/screen.md, Header and hub QR). The zone placed the box itself when its area (the
   * parts' together) differs from the published layout's and still fits; otherwise it goes where
   * the draft puts it, and its parts split that area the way screen splits it.
   */
  function placed(parts, published, mine, grid) {
    const first = parts[0];
    const own = { ...first.area, columns: parts.reduce((sum, p) => sum + p.area.columns, 0) };
    const area = !sameArea(own, published) && fits(own, grid) ? own : mine.area;
    const layer = mine.layer ?? 0;
    if (area.columns < parts.length) return [whole(parts, area, layer)];
    return columnsOf(area, parts.length).map((a, i) => ({ ...parts[i], area: a, layer }));
  }

  /*
   * The draft's layout of the id the zone draws, as screen would place it (`placed`), a box the
   * draft drops gone. The synthetic regions (`_full`, `_overlay`) stay. Without a layout of that
   * id the published one stays: only screen knows its fallback.
   */
  function withLayouts(state, layouts) {
    const published = state.layout;
    const layout = layouts.find((l) => l.id === published?.id);
    const theme = { ...state.theme, layouts };
    if (layout === undefined) return { ...state, theme };
    const before = new Map((published.regions ?? []).map((r) => [r.id, r.area]));
    const after = new Map(layout.regions.map((r) => [r.id, r]));
    // A part's id is its box's id and its place; a layout box's own id is never a part's.
    const boxOf = (id) => {
      const part = /^(.+)-(\d+)$/.exec(id);
      if (after.has(id) || part === null || !after.has(part[1])) return [id, 1];
      return [part[1], Number(part[2])];
    };
    const boxes = new Map();
    for (const r of state.regions) {
      const [box, n] = boxOf(r.id);
      if (after.has(box)) boxes.set(box, [...(boxes.get(box) ?? []), { n, r }]);
    }
    const drawn = new Map();
    for (const [box, parts] of boxes) {
      const inOrder = parts.sort((a, b) => a.n - b.n).map((p) => p.r);
      for (const r of placed(inOrder, before.get(box), after.get(box), layout.grid))
        drawn.set(r.id, r);
    }
    const regions = state.regions.flatMap((r) =>
      r.id.startsWith("_") ? [r] : drawn.has(r.id) ? [drawn.get(r.id)] : [],
    );
    return { ...state, theme, layout, regions };
  }

  function withDraft(state) {
    const d = screenFrame.dataset;
    if (d.tokensCssUrl === undefined) return undefined;
    const logo = d.logoUrl ?? null;
    // As screen composes the views (contracts/screen.md, Widgets): the logo widget shows the
    // draft's logo or is empty, and an embed is handed the draft's logo or none.
    const withLogo = (w) => {
      if (w?.widget === "logo") {
        const view = { ...w.view };
        delete view.url;
        return {
          ...w,
          view:
            logo === null
              ? { ...view, empty: true }
              : { ...view, url: logo, name: view.name ?? state.tenant?.name ?? "", empty: false },
        };
      }
      return w?.widget === "embed" && w.view ? { ...w, view: { ...w.view, logo_url: logo } } : w;
    };
    const drafted = withLayouts(state, JSON.parse(d.layouts ?? "[]"));
    return {
      ...drafted,
      theme: {
        ...drafted.theme,
        tokens_css_url: d.tokensCssUrl,
        css_url: d.cssUrl ?? null,
        logo_url: logo,
        templates: JSON.parse(d.templates ?? "[]"),
      },
      regions: drafted.regions.map((r) => ({
        ...r,
        widgets: r.widgets.map(withLogo),
        idle_view: withLogo(r.idle_view),
      })),
    };
  }

  /** A frame's earlier load handler goes, so it never posts its state into the next page. */
  function load(src, onLoad) {
    zoneState = undefined;
    screenShown = false;
    awaited = undefined;
    clearTimeout(unanswered);
    if (onScreenLoad !== undefined) screenFrame.removeEventListener("load", onScreenLoad);
    onScreenLoad = onLoad;
    screenFrame.addEventListener("load", onLoad, { once: true });
    screenFrame.src = src;
  }

  function fallback() {
    const caption = document.querySelector(".canccu-studio-zone");
    if (caption !== null) caption.textContent = "";
    load(screenFrame.dataset.fallbackSrc, () => {
      screenShown = isSurface(screenFrame);
      check();
    });
  }

  async function showZone(zone) {
    const pick = ++zonePicks;
    const key = encodeURIComponent(zone.key);
    const state = await readJson(`/api/screen/zones/${key}/state`);
    if (pick !== zonePicks) return;
    if (state === undefined || !Array.isArray(state.regions)) return fallback();
    const caption = document.querySelector(".canccu-studio-zone");
    if (caption !== null) caption.textContent = `· ${zone.name}`;
    load(`/screen/zones/${key}`, () => {
      zoneState = state;
      post();
    });
  }

  /** The zone's state with the draft as it is now, for the frame to draw instead of the live zone. */
  function post() {
    const draft = withDraft(zoneState);
    // Without a draft nothing is held; a state the player refuses is never answered.
    if (draft === undefined) return;
    screenShown = false;
    clearTimeout(unanswered);
    awaited = ++posts;
    screenFrame.contentWindow.postMessage(
      { type: PREVIEW_MESSAGE, state: draft, id: awaited },
      location.origin,
    );
    unanswered = setTimeout(fallback, ANSWER_MS);
  }

  addEventListener("message", (event) => {
    if (event.source !== screenFrame?.contentWindow || event.origin !== location.origin) return;
    if (event.data?.type !== DRAWN_MESSAGE || awaited === undefined) return;
    if (event.data.id !== awaited) return;
    clearTimeout(unanswered);
    screenShown = true;
    check();
  });

  async function startScreen() {
    const zones = (await readJson("/api/screen/zones"))?.zones;
    if (!Array.isArray(zones) || zones.length === 0) return fallback();
    const select = document.querySelector(".canccu-studio-zones");
    const first = zones.find((z) => z.key === "main") ?? zones[0];
    if (select !== null && zones.length > 1) {
      for (const z of zones) select.add(new Option(z.name, z.key, false, z === first));
      select.hidden = false;
      select.addEventListener("change", () => {
        const zone = zones.find((z) => z.key === select.value);
        if (zone !== undefined) void showZone(zone);
      });
    }
    await showZone(first);
  }

  /*
   * Publishing changed CSS needs its preview first (D10): the button waits until every preview
   * frame shows this draft version: a surface page of the Studio's, or the screen that drew the
   * draft. A frame may finish before this script runs.
   */
  function isSurface(frame) {
    const doc = frame.contentDocument;
    return (
      doc !== null && doc.readyState === "complete" && doc.querySelector(".canccu-surface") !== null
    );
  }
  const shown = (frame) =>
    frame === screenFrame ? screenShown : !loading.has(frame) && isSurface(frame);
  // Read each time: a save draws the title row again (studio-live.js).
  const held = () => [...document.querySelectorAll("[data-needs-preview]")];
  const frames = [...document.querySelectorAll("iframe[data-preview]")];
  // Set by studio.js once a save has made the drawn version older than the draft (until a reload).
  const stale = () => document.querySelector(".canccu-studio")?.dataset.previewStale === "1";
  function check() {
    const buttons = held();
    if (buttons.length === 0 || stale() || !frames.every(shown)) return;
    for (const button of buttons) button.disabled = false;
    const hint = document.querySelector(".canccu-studio-publish-hint");
    if (hint !== null) hint.textContent = "Previews shown: this version can be published.";
  }
  for (const frame of frames) {
    if (frame === screenFrame) continue;
    frame.addEventListener("load", () => {
      loading.delete(frame);
      check();
    });
  }

  /*
   * After a save (studio-live.js): the screen frame gets the saved draft posted again, never a
   * reload, so its boxes stay where a paired screen has them; the hub frames load the saved version.
   * Publish waits for both again when it holds for the preview.
   */
  document.addEventListener("canccu-studio-redraw", (event) => {
    const doc = event.detail;
    const next = doc.querySelector("iframe[data-screen-preview]");
    if (screenFrame !== null && next !== null) {
      for (const key of [
        "tokensCssUrl",
        "cssUrl",
        "logoUrl",
        "templates",
        "layouts",
        "fallbackSrc",
      ]) {
        if (next.dataset[key] === undefined) delete screenFrame.dataset[key];
        else screenFrame.dataset[key] = next.dataset[key];
      }
      if (zoneState !== undefined) post();
      else if (screenFrame.getAttribute("src") === screenFrame.dataset.fallbackSrc) {
        // Already the newest sample; nothing to load.
      } else if (screenFrame.getAttribute("src")?.startsWith("/theming/")) fallback();
    }
    for (const frame of frames) {
      if (frame === screenFrame) continue;
      const src = doc
        .querySelector(`iframe[data-surface="${frame.dataset.surface}"]`)
        ?.getAttribute("src");
      if (src === undefined || src === null || src === frame.getAttribute("src")) continue;
      loading.add(frame);
      frame.src = src;
    }
    check();
  });
  if (screenFrame !== null) void startScreen();
  check();
})();
