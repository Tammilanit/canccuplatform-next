// The handed states of the motion and stage shots (screens.mjs, `handed`), apart from handed.mjs
// for its size: each level's drawing of a spotlight, and the stage's layers with a surge's tint.
import { GAME, claim, keyArt } from "./handed.mjs";

const COVER = GAME.cover_url;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
/**
 * The energy levels and packs at the countdown's 5-minute mark (sheet 11, #445): the hero counts
 * down to an item 4 m 50 s away, so its spotlight holds, and the frames show how each level draws it.
 */
export const MOTION_VIEWS = [
  ["none", "standard"],
  ["calm", "standard"],
  ["lively", "standard"],
  ["party", "standard"],
  ["lively", "broadcast"],
  ["lively", "arcade"],
  ["party", "arcade"],
].map(([level, pack]) => ({ view: `motion-${level}-${pack}`, level, pack }));

export function withMotion(level, pack) {
  const target_at = new Date(Date.now() + 290_000).toISOString();
  const soon = (v) => ({ ...v, view: { ...v.view, target_at } });
  // With a tournament or ceremony ahead the hero plays tonight's highlight, a countdown, rather
  // than its idle view (#447): that countdown then counts down, and holds the hero.
  const hero = (r) => {
    const widgets = r.widgets.map((w) => (w.widget === "countdown" && !w.view.empty ? soon(w) : w));
    const counting = widgets.findIndex((w) => w.widget === "countdown" && !w.view.empty);
    const idle_view = r.idle_view === null ? null : soon(r.idle_view);
    return { ...r, widgets, idle_view, ...(counting < 0 ? {} : { order: [counting] }) };
  };
  return (s) => ({
    ...s,
    display: { ...s.display, motion_level: level, motion_style: { ...s.display?.motion_style, pack } },
    regions: s.regions.map((r) => (r.role === "hero" ? hero(r) : r)),
  }); // prettier-ignore
}

/**
 * The two backgrounds (sheet 15, #446). The stage's art as the server sends it is a blurred WebP
 * of a game's cover; here the demo cover, blurred as data, stands in for it, so the frame is the
 * player's own. Its `scrim` and the cards' `veil` are fixed values, not what the server would
 * compute for this cover (src/stage/scrim.ts, from the art's lightest and darkest colour, which
 * only the server reads): the shots show how the player draws a scrim and a veil it is handed.
 */
const blurred = keyArt(18);

/** Each stage view's level, the item's kind and the day's phase; `surge` adds a box's tint. */
export const STAGE_VIEWS = [
  { view: "stage-calm", level: "calm", surge: false },
  { view: "stage-lively", level: "lively", surge: false },
  { view: "stage-party", level: "party", surge: false },
  { view: "stage-surge", level: "lively", surge: true },
];

/** The hot game's claim in the hero, its surge just started, with its card art. */
function surgeClaim() {
  return claim("hero", "hot_game", {
    game: GAME,
    players: 14,
    since: ago(1000),
    card_art: { url: COVER, veil: 0.75 },
  });
}

/**
 * The stage at a level: the current item a tournament at the evening's peak. A surge puts the hot
 * game's claim in the hero and tints the stage with its art for `tintMs` from the first state.
 */
export function withStage(level, surge, tintMs = 0) {
  // From the first state handed, so the page's later polls keep the same end.
  let until;
  return (s) => ({
    ...s,
    display: {
      ...s.display,
      motion_level: level,
      stage: {
        phase: "peak",
        kind: "tournament",
        tint: surge
          ? {
              region_id: "hero",
              widget: "hot_game",
              until: (until ??= new Date(Date.now() + tintMs).toISOString()),
              art: { url: blurred, scrim: 0.7 },
            }
          : null,
      },
    },
    regions: surge
      ? s.regions.map((r) => (r.role === "hero" ? { ...r, claim: surgeClaim() } : r))
      : s.regions,
  });
}

/**
 * The Pulse hero of sheets 9–10: tonight's final with its game's band and card art, the teams
 * still in, its description, and the chip of the semis, which start first.
 */
export function withHeroArt(s) {
  const hour = 3_600_000;
  const extra = {
    target_at: new Date(Date.now() + 2.5 * hour).toISOString(),
    label: "Demo Game Cup grand final",
    kind: "tournament",
    description: "Bring your own headset. Seats open 20:30.",
    game: GAME,
    teams_left: 8,
    chip: { label: "Semis", target_at: new Date(Date.now() + hour).toISOString() },
    card_art: { url: COVER, veil: 0.8 },
  };
  return {
    ...withStage("lively", false)(s),
    regions: s.regions.map((r) =>
      r.role !== "hero" || r.idle_view === null
        ? r
        : { ...r, idle_view: { ...r.idle_view, view: { ...r.idle_view.view, ...extra } } },
    ),
  };
}
