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
  let screenShown = false;
  // Only the answer to the last state posted counts: an earlier zone's may still come in.
  let posts = 0;
  let awaited;
  let zonePicks = 0;
  let onScreenLoad;

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

  /*
   * The draft's layout of the id the zone draws, as screen would place it: each box where the
   * draft puts it, except one the zone placed itself (its area differs from the published layout's
   * and still fits), and a box the draft drops gone. The synthetic regions (`_full`, `_overlay`)
   * stay. Without a layout of that id the published one stays: only screen knows its fallback.
   */
  function withLayouts(state, layouts) {
    const published = state.layout;
    const layout = layouts.find((l) => l.id === published?.id);
    const theme = { ...state.theme, layouts };
    if (layout === undefined) return { ...state, theme };
    const before = new Map((published.regions ?? []).map((r) => [r.id, r.area]));
    const after = new Map(layout.regions.map((r) => [r.id, r]));
    const regions = state.regions
      .filter((r) => r.id.startsWith("_") || after.has(r.id))
      .map((r) => {
        const mine = after.get(r.id);
        if (mine === undefined) return r;
        const placed = !sameArea(r.area, before.get(r.id)) && fits(r.area, layout.grid);
        return { ...r, area: placed ? r.area : mine.area, layer: mine.layer ?? 0 };
      });
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
    screenShown = false;
    awaited = undefined;
    if (onScreenLoad !== undefined) screenFrame.removeEventListener("load", onScreenLoad);
    onScreenLoad = onLoad;
    screenFrame.addEventListener("load", onLoad, { once: true });
    screenFrame.src = src;
  }

  const fallback = () =>
    load(screenFrame.dataset.fallbackSrc, () => {
      screenShown = isSurface(screenFrame);
      check();
    });

  async function showZone(zone) {
    const pick = ++zonePicks;
    const key = encodeURIComponent(zone.key);
    const state = await readJson(`/api/screen/zones/${key}/state`);
    if (pick !== zonePicks) return;
    if (state === undefined || !Array.isArray(state.regions)) return fallback();
    const caption = document.querySelector(".canccu-studio-zone");
    if (caption !== null) caption.textContent = `· ${zone.name}`;
    const draft = withDraft(state);
    load(`/screen/zones/${key}`, () => {
      // Without a draft nothing is held; a state the player refuses is never answered.
      if (draft === undefined) return;
      awaited = ++posts;
      screenFrame.contentWindow.postMessage(
        { type: PREVIEW_MESSAGE, state: draft, id: awaited },
        location.origin,
      );
    });
  }

  addEventListener("message", (event) => {
    if (event.source !== screenFrame?.contentWindow || event.origin !== location.origin) return;
    if (event.data?.type !== DRAWN_MESSAGE || awaited === undefined) return;
    if (event.data.id !== awaited) return;
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
  const shown = (frame) => (frame === screenFrame ? screenShown : isSurface(frame));
  const held = [...document.querySelectorAll("[data-needs-preview]")];
  const frames = [...document.querySelectorAll("iframe[data-preview]")];
  function check() {
    if (held.length === 0 || !frames.every(shown)) return;
    for (const button of held) button.disabled = false;
    const hint = document.querySelector(".canccu-studio-publish-hint");
    if (hint !== null) hint.textContent = "Previews shown: this version can be published.";
  }
  for (const frame of frames) if (frame !== screenFrame) frame.addEventListener("load", check);
  if (screenFrame !== null) void startScreen();
  check();
})();
