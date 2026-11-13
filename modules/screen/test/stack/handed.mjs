// The states the screen shots hand the page instead of the server's (screens.mjs, `handed`): the
// views the demo stack cannot reach by itself, a claim from Moments, a photo beside the countdown,
// a gap in the run of show, a Dashboard with statistics and its showcase. Each changes the server's real state, so the
// frame around it is the real one.
const ago = (ms) => new Date(Date.now() - ms).toISOString();
export const claim = (role, template, content) => ({
  override_id: `ov_${role}`,
  hidden: false,
  role,
  rank: role === "full" ? 100 : 80,
  template,
  content,
  steps: null,
  sound: null,
  on_end: "resume",
  starts_at: ago(1000),
  ends_at: null,
  expires_at: null,
});
// A cover and a photo drawn here: the page takes data: images (src/tree.ts).
const picture = (a, b) =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="160" height="120" fill="url(#g)"/><circle cx="80" cy="52" r="22" fill="#fff" fill-opacity=".35"/><rect x="44" y="80" width="72" height="30" rx="12" fill="#fff" fill-opacity=".35"/></svg>`,
  ).toString("base64")}`;
/** What each claim view puts in the state (mockup 04). */
export const CLAIM_OF = {
  "claim-rail": ["rail", claim("rail", "announcement", { title: "Dinner is served", body: "Café, until 19:15", level: "info" })],
  "claim-hero": ["hero", claim("hero", "hot_game", { game: { id: "g_1", name: "Demo Game", cover_url: picture("#7c3aed", "#0ea5e9") }, players: 14, since: ago(600_000) })],
  "claim-overlay": ["overlay", claim("overlay", "match_called", { label: "Team Alpha vs Team Gamma", game_name: "Go to Stage 2 · voice: Match 7", teams: [] })],
  "claim-takeover": ["full", claim("full", "announcement", { title: "Please leave the hall", body: "Follow the exit signs.", level: "emergency" })],
}; // prettier-ignore

/** A photo in the hero beside the countdown, so the hero rotates (mockup 03's café). */
export function withPhoto(s) {
  const photo = {
    widget: "photo",
    template: null,
    dwell_seconds: 3600,
    stale_after_seconds: null,
    view: { url: picture("#1e3a8a", "#6d28d9"), caption: 'New photo · "Setup day"', author_name: "Player One", qr: null, stale: false, empty: false },
  }; // prettier-ignore
  return {
    ...s,
    regions: s.regions.map((r) =>
      r.role !== "hero" || r.idle_view === null
        ? r
        : { ...r, order: [0, 1], widgets: [photo, { ...r.idle_view, template: null, dwell_seconds: 15, stale_after_seconds: null }] },
    ), // prettier-ignore
  };
}

/**
 * A gap in the run of show: the rail's only row is the item the hero counts down to, which the
 * rail leaves out (player/src/hero-rail.ts), and nothing comes after it, so the rail shows its idle
 * choice, not an empty card.
 */
export function withHeroItemOnly(s) {
  const next = s.regions.find((r) => r.role === "hero")?.idle_view?.view;
  if (next === undefined) throw new Error("the demo zone's hero has no idle countdown");
  const only = (w) =>
    w.widget !== "agenda_now"
      ? w
      : { ...w, view: { ...w.view, later: [], items: w.view.items.filter((row) => row.name === next.label && row.starts_at === next.target_at) } }; // prettier-ignore
  return {
    ...s,
    regions: s.regions.map((r) => (r.role === "rail" ? { ...r, widgets: r.widgets.map(only) } : r)),
  };
}

/** Sample statistics as the bot's data will bring them (#389), with sheet 10's trend arrows. */
const SAMPLE = {
  stats: { members: 1240, online: 218, in_voice: 38, members_trend: "flat", online_trend: "up", in_voice_trend: "up" },
  now_playing: {
    available: true,
    games: [
      { game_id: "g_1", name: "Demo Game", players: 41, trend: "flat" },
      { game_id: "g_2", name: "Demo Racer", players: 23, trend: "up" },
      { game_id: "g_3", name: "Demo Quest", players: 17, trend: "down" },
    ],
  },
}; // prettier-ignore
const STATISTICS = ["online", "voice", "top_games", "right_now"];

/**
 * Dashboard with its statistics: the server leaves the four boxes out while their source is not
 * there (contracts/screen.md, Boxes waiting for their source), so they come back here at the
 * layout's areas, with the hero and the rail at theirs, as the server composes them once the
 * statistics reach it.
 */
export function withStats(s) {
  const placed = new Map(s.layout.regions.map((r) => [r.id, r]));
  const rail = s.regions.find((r) => r.id === "rail");
  if (rail === undefined || !STATISTICS.every((id) => placed.has(id)))
    throw new Error("the demo zone is not on the Dashboard");
  const boxes = STATISTICS.map((id) => ({
    ...rail,
    id,
    role: null,
    area: placed.get(id).area,
    order: [0],
    idle: "logo",
    idle_view: null,
    claim: null,
    widgets: placed.get(id).widgets.map((w) => ({
      widget: w.widget,
      template: null,
      embed: null,
      dwell_seconds: 15,
      stale_after_seconds: null,
      view: { ...SAMPLE[w.widget], qr: null, stale: false, empty: false },
    })),
  }));
  const regions = s.regions.map((r) =>
    r.id === "hero" || r.id === "rail" ? { ...r, area: placed.get(r.id).area } : r,
  );
  const at = regions.findIndex((r) => r.id === "rail");
  return { ...s, regions: [...regions.slice(0, at), ...boxes, ...regions.slice(at)] };
}

/**
 * Dashboard during a showcase (contracts/screen.md, The hero role and the showcase): a spotlight in
 * the hero, grown to 8×10, and two boxes beside it, `rail` picked first, stacked in layout order:
 * `online` and `rail`, 4×5 each (src/compose/showcase.ts). `voice`, `top_games` and `right_now`
 * pause. The rail stays on its countdown, the tallest widget its box has to fit.
 */
export function withShowcase(s) {
  const kept = ["online", "rail"];
  const paused = new Set(["voice", "top_games", "right_now"]);
  const spotlight = claim("hero", "announcement", { title: "Grand final on stage", body: "Seats open 20:30 · bring your own headset", level: "info" }); // prettier-ignore
  return {
    ...s,
    regions: s.regions.flatMap((r) => {
      if (paused.has(r.id)) return [];
      if (r.id === "hero")
        return [{ ...r, claim: spotlight, area: { column: 1, row: 2, columns: 8, rows: 10 } }];
      const i = kept.indexOf(r.id);
      if (i < 0) return [r];
      const area = { column: 9, row: 2 + 5 * i, columns: 4, rows: 5 };
      if (r.id !== "rail") return [{ ...r, area }];
      const countdown = r.widgets.findIndex((w) => w.widget === "countdown" && !w.view.empty);
      if (countdown < 0) throw new Error("the demo Dashboard's rail has no countdown to show");
      return [{ ...r, area, order: [countdown] }];
    }),
  };
}

/** An emergency takeover over whatever layout the zone is on (contracts/screen.md, Claims). */
export function withTakeover(s) {
  const [role, placed] = CLAIM_OF["claim-takeover"];
  return { ...s, regions: s.regions.map((r) => (r.role === role ? { ...r, claim: placed } : r)) };
}
