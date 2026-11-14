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
// The photos drawn here: the page takes data: images (src/tree.ts).
const picture = (a, b) =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="160" height="120" fill="url(#g)"/><circle cx="80" cy="52" r="22" fill="#fff" fill-opacity=".35"/><rect x="44" y="80" width="72" height="30" rx="12" fill="#fff" fill-opacity=".35"/></svg>`,
  ).toString("base64")}`;
/**
 * A handed view is a screen at play: the stream the shot holds back must not read as an outage,
 * or the player marks itself offline after 10 s (player/src/live.ts) and the book shows it.
 */
export async function stillOnline(page) {
  if ((await page.$(".canccu-offline-marker")) !== null)
    throw new Error('it shows "offline since": the held-back stream reads as an outage');
}
/**
 * The handed page's stream, answered open and empty: nothing the server pushes replaces the handed
 * state, yet the player sees a live stream. Each answer ends at once and the player reconnects
 * after its `retry` (1 s), well inside the 10 s after which it marks itself offline
 * (player/src/live.ts, stream.ts); a cut stream would put "offline since" on the shot.
 */
export const holdStream = (page) =>
  page.route("**/api/screen/device/stream", (route) =>
    route
      .fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 1000\n\n" })
      .catch(() => undefined),
  );
/**
 * The demo game's cover: abstract key art in the default theme's colours (ridges under a glow, a
 * light streak, an emblem), so its card art and the stage's wash read as a game, not as the
 * person placeholder the photos use. `blur` is the stage's blurred copy of it.
 */
const keyArt = (blur = 0) =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="s" x2="0" y2="1"><stop offset="0" stop-color="#1d2142"/><stop offset="1" stop-color="#0b0d1a"/></linearGradient><radialGradient id="g" cx=".62" cy=".36" r=".45"><stop offset="0" stop-color="#b98cff" stop-opacity=".9"/><stop offset=".5" stop-color="#b98cff" stop-opacity=".3"/><stop offset="1" stop-color="#b98cff" stop-opacity="0"/></radialGradient><linearGradient id="l" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#3ddcff" stop-opacity="0"/><stop offset=".55" stop-color="#3ddcff"/><stop offset="1" stop-color="#3ddcff" stop-opacity="0"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="${blur}"/></filter></defs><rect width="320" height="180" fill="#0b0d1a"/><g filter="${blur ? "url(#b)" : "none"}"><rect width="320" height="180" fill="url(#s)"/><rect width="320" height="180" fill="url(#g)"/><path d="M0 124 46 94l32 16 44-42 36 30 40-40 38 36 34-18 50 32v72H0Z" fill="#343c66"/><path d="M0 150 58 116l38 22 54-36 46 34 50-26 74 34v36H0Z" fill="#161a2e"/><path d="M20 180 296 18l8 8L44 180Z" fill="url(#l)"/><path d="M198 30l20 28-20 28-20-28Z" fill="none" stroke="#3ddcff" stroke-width="4"/><path d="M198 46l9 12-9 12-9-12Z" fill="#f3f5ff"/><circle cx="62" cy="34" r="1.6" fill="#f3f5ff"/><circle cx="118" cy="22" r="1.2" fill="#f3f5ff"/><circle cx="272" cy="40" r="1.4" fill="#f3f5ff"/></g></svg>`,
  ).toString("base64")}`;
const COVER = keyArt();
export const GAME = { id: "g_1", name: "Demo Game", cover_url: COVER };

/** What each claim view puts in the state (mockup 04). */
export const CLAIM_OF = {
  "claim-rail": ["rail", claim("rail", "announcement", { title: "Dinner is served", body: "Café, until 19:15", level: "info" })],
  "claim-hero": ["hero", claim("hero", "hot_game", { game: GAME, players: 14, since: ago(600_000) })],
  "claim-overlay": ["overlay", claim("overlay", "match_called", { label: "Team Alpha vs Team Gamma", game_name: "Go to Stage 2 · voice: Match 7", teams: [] })],
  "claim-takeover": ["full", claim("full", "announcement", { title: "Please leave the hall", body: "Follow the exit signs.", level: "emergency" })],
  // A `block` override starts at the hero (contracts/screen.md): an alarm sent as one lands there.
  "claim-hero-emergency": ["hero", claim("hero", "announcement", { title: "Please leave the hall", body: "Follow the exit signs.", level: "emergency" })],
}; // prettier-ignore

export const TILES = [
  [picture("#1e3a8a", "#6d28d9"), "Setup day"],
  [picture("#065f46", "#0e7490"), "Cable art"],
  [picture("#7c2d12", "#b45309"), "Midnight pizza"],
  [picture("#4c1d95", "#be185d"), "The finals"],
  [picture("#134e4a", "#4d7c0f"), "Team photo"],
].map(([url, caption]) => ({
  url,
  caption,
  author_name: "Player One",
  posted_at: "2026-03-14T17:00:00Z",
}));

/**
 * The photo wall in the hero beside the countdown, so the hero rotates (change 6, sheets 13 and 16):
 * five tiles, the lead large; `featured` is a new photo popping over the whole box.
 */
export function withPhoto(s, featured = false) {
  const photo = {
    widget: "photo",
    template: null,
    dwell_seconds: 3600,
    stale_after_seconds: null,
    view: { ...TILES[0], featured, tiles: TILES, qr: null, stale: false, empty: false },
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

/** One bar of a graph as graph.ts makes it: out of 10 against `top`, named on every `every`th hour. */
export function hour(h, value, top, every) {
  const time_text = `${String(h).padStart(2, "0")}:00`;
  const level = Math.round((10 * value) / top);
  return { time_text, value, level, ...(h % every === 0 ? { tick_text: time_text } : {}) };
}

/** Sample statistics as the bot's data will bring them (#389), with sheet 10's trend arrows. */
const SAMPLE = {
  stats: {
    members: 1240, online: 218, in_voice: 38, checked_in: 164,
    members_trend: "flat", online_trend: "up", in_voice_trend: "flat",
    online_peak: { count: 231, at: "2026-03-14T23:30:00Z", time_text: "01:30" },
    in_voice_peak: { count: 64, at: "2026-03-14T21:00:00Z", time_text: "23:00" },
  },
  now_playing: {
    available: true,
    games: [
      { game_id: "g_1", name: "Demo Game", players: 41, trend: "flat" },
      { game_id: "g_2", name: "Demo Racer", players: 23, trend: "up" },
      { game_id: "g_3", name: "Demo Quest", players: 17, trend: "down" },
    ],
  },
  // The last 24 hours by the hour (sheet 10's "Online · 24 h").
  activity_graph: {
    metric: "online",
    label: "Online · 24 h",
    peak: { count: 231, at: "2026-03-14T23:30:00Z", time_text: "01:30" },
    // The scale and the labelled hours as graph.ts makes them: round steps, every sixth hour named.
    scale: [300, 200, 100, 0].map((value) => ({ value })),
    points: [96, 80, 61, 44, 30, 22, 25, 41, 70, 104, 132, 151, 170, 166, 158, 172, 190, 201, 214, 231, 225, 212, 205, 218].map(
      (value, i) => hour((19 + i) % 24, value, 300, 6),
    ),
  },
}; // prettier-ignore
/** `voice` waits for the bot's per-room counts (`voice_rooms`), so `online` takes its cells. */
const STATISTICS = ["online", "top_games", "right_now"];
const GIVEN = { online: { column: 5, row: 2, columns: 8, rows: 5 } };

/** The zone's `stats` regions given the sample counts: Portrait's Right now, Ambient's line. */
export function withCounts(s) {
  const counted = (w) =>
    w.widget !== "stats"
      ? w
      : { ...w, view: { ...SAMPLE.stats, qr: null, stale: false, empty: false } };
  return { ...s, regions: s.regions.map((r) => ({ ...r, widgets: r.widgets.map(counted) })) };
}

/** One screen at the event: the header leaves the zone's name out (`screen_name` auto). */
export function withOneScreen(s) {
  return { ...s, zone: { ...s.zone, show_name: false } };
}

/**
 * Dashboard with its statistics: the server leaves the four boxes out while their source is not
 * there (contracts/screen.md, Boxes waiting for their source), so they come back here at the
 * layout's areas, with the hero and the rail at theirs, as the server composes them once the
 * statistics reach it; the voice rooms still wait.
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
    area: GIVEN[id] ?? placed.get(id).area,
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
 * player's own. `scrim` is what the server computes for it under the default theme.
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
