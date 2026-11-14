import { describe, expect, it } from "vitest";
import type { RegionView } from "../src/compose/build.js";
import type { Claim } from "../src/compose/claims.js";
import { TINT_MS, kindOf, stageOf, tintAsked } from "../src/compose/stage.js";
import { countdownFields } from "../src/compose/widgets.js";
import type { AgendaItem, ZoneFacts } from "../src/compose/widgets.js";
import type { ArtCache, ArtInfo } from "../src/stage/art.js";
import { themeColors, veilOf } from "../src/stage/scrim.js";

const NOW = Date.parse("2026-01-01T21:10:30Z");
const iso = (ms: number) => new Date(ms).toISOString();
const game = (id: string) => ({ id, name: `Game ${id}`, cover_url: `/games/covers/${id}.webp` });
const hot = (id: string, sinceMs: number) => ({ game: game(id), players: 14, since: iso(sinceMs) });

function region(id: string, over: Partial<RegionView> = {}): RegionView {
  return {
    id,
    role: null,
    area: { column: 1, row: 1, columns: 1, rows: 1 },
    layer: 0,
    rotation: "sequence",
    order: [],
    indicator: "line",
    cycle_started_at: iso(0),
    idle: "logo",
    idle_view: null,
    widgets: [],
    claim: null,
    ...over,
  };
}
const widget = (type: string, view: Record<string, unknown>) => ({
  widget: type,
  template: null,
  embed: null,
  dwell_seconds: 15,
  stale_after_seconds: null,
  view: { qr: null, stale: false, empty: false, ...view },
});
const claimOf = (template: string, content: Record<string, unknown>, hidden = false) =>
  ({ override_id: "ov_1", hidden, role: "hero", rank: 50, template, content }) as unknown as Claim;
const views = (regions: RegionView[]) => ({ landscape: { regions }, portrait: { regions } });

const INFO: ArtInfo = {
  id: "a".repeat(64),
  art: { light: [255, 255, 255], dark: [0, 0, 0] },
  cover: { light: [200, 200, 200], dark: [10, 10, 10] },
};
const cache = (known: string[]) =>
  ({
    of: (_host: string, url: unknown) =>
      Promise.resolve(typeof url === "string" && known.includes(url) ? INFO : null),
  }) as unknown as ArtCache;

const base = {
  phase: "peak" as const,
  agenda: null,
  nowMs: NOW,
  stageArt: true,
  colors: themeColors(undefined),
  hostname: "event.example",
};

describe("the stage", () => {
  it("takes a tint from a hot game's surge for 60 s from its since", () => {
    const v = views([region("hero", { claim: claimOf("hot_game", hot("g_1", NOW - 10_000)) })]);
    expect(tintAsked(v, NOW)).toEqual({
      region_id: "hero",
      widget: "hot_game",
      until: NOW - 10_000 + TINT_MS,
      cover_url: "/games/covers/g_1.webp",
    });
    expect(tintAsked(v, NOW - 10_000 + TINT_MS)).toBeNull();
    // A surge stamped after now asks nothing yet.
    expect(tintAsked(v, NOW - 20_000)).toBeNull();
  });

  it("lets the newest surge win, and ignores hidden claims and empty widgets", () => {
    const v = views([
      region("hero", { claim: claimOf("hot_game", hot("g_1", NOW - 30_000)) }),
      region("rail", { widgets: [widget("hot_game", hot("g_2", NOW - 5_000))] }),
      region("side", { claim: claimOf("hot_game", hot("g_3", NOW - 1_000), true) }),
      region("foot", { widgets: [widget("hot_game", { ...hot("g_4", NOW), empty: true })] }),
    ]);
    expect(tintAsked(v, NOW)?.region_id).toBe("rail");
  });

  it("names the current public item's kind", () => {
    const item = (kind: string, visibility = "public") => ({ kind, visibility }) as AgendaItem;
    expect(kindOf({ current: [item("crew_brief", "crew"), item("tournament")], next: [] })).toBe(
      "tournament",
    );
    expect(kindOf({ current: [], next: [item("talk")] })).toBeNull();
    expect(kindOf(null)).toBeNull();
  });

  it("carries the blurred art with its scrim, and the cards their cover with a veil", async () => {
    const v = views([region("hero", { claim: claimOf("hot_game", hot("g_1", NOW - 10_000)) })]);
    const { stage, covers } = await stageOf({
      ...base,
      views: v,
      art: cache(["/games/covers/g_1.webp"]),
    });
    expect(stage.phase).toBe("peak");
    expect(stage.tint?.art?.url).toBe(`/api/screen/art/${INFO.id}.webp`);
    expect(stage.tint?.art?.scrim).toBeGreaterThanOrEqual(0.55);
    expect(stage.tint?.until).toBe(iso(NOW - 10_000 + TINT_MS));
    expect(v.landscape.regions[0]?.claim?.content.card_art).toEqual({
      url: "/games/covers/g_1.webp",
      veil: veilOf(base.colors, INFO.cover),
    });
    expect(covers).toEqual([`/games/covers/g_1.webp=${INFO.id}`]);
  });

  it("keeps the tint's colours without art while the event switches it off, and the card art stays", async () => {
    const v = views([region("hero", { claim: claimOf("hot_game", hot("g_1", NOW - 10_000)) })]);
    const { stage } = await stageOf({
      ...base,
      stageArt: false,
      views: v,
      art: cache(["/games/covers/g_1.webp"]),
    });
    expect(stage.tint).not.toBeNull();
    expect(stage.tint?.art).toBeNull();
    expect(v.landscape.regions[0]?.claim?.content.card_art).toBeDefined();
  });

  it("gives each step of a sequence claim its own card art, as the surge plays it", async () => {
    // contracts/screen.md's hot-game surge: a sting, then the hot game's card, each with its content.
    const claim = {
      ...claimOf("sting", { text: "Hot right now", image_url: null }),
      steps: [
        {
          template: "sting",
          content: { text: "Hot right now", image_url: null },
          duration_ms: 2500,
        },
        { template: "hot_game", content: hot("g_2", NOW - 10_000), duration_ms: 30_000 },
      ],
    } as unknown as Claim;
    const v = views([region("hero", { claim })]);
    const { covers } = await stageOf({ ...base, views: v, art: cache(["/games/covers/g_2.webp"]) });
    expect(covers).toEqual([`/games/covers/g_2.webp=${INFO.id}`]);
    const steps = v.landscape.regions[0]?.claim?.steps;
    expect(steps?.[0]?.content.card_art).toBeUndefined();
    expect(steps?.[1]?.content.card_art).toEqual({
      url: "/games/covers/g_2.webp",
      veil: veilOf(base.colors, INFO.cover),
    });
    expect(steps?.[1]?.duration_ms).toBe(30_000);
    expect(v.landscape.regions[0]?.claim?.content.card_art).toBeUndefined();
  });

  it("leaves the art out where the cover cannot be read", async () => {
    const v = views([region("hero", { widgets: [widget("hot_game", hot("g_1", NOW - 1_000))] })]);
    const { stage } = await stageOf({ ...base, views: v, art: cache([]) });
    expect(stage.tint?.art).toBeNull();
    expect(v.landscape.regions[0]?.widgets[0]?.view.card_art).toBeUndefined();
  });

  it("has no tint while no box asks", async () => {
    const { stage } = await stageOf({ ...base, views: views([region("hero")]), art: cache([]) });
    expect(stage).toEqual({ phase: "peak", kind: null, tint: null });
  });
});

describe("the Pulse hero's countdown", () => {
  const item = (id: string, starts: string, extra: Partial<AgendaItem> = {}): AgendaItem => ({
    id,
    title: `Item ${id}`,
    kind: "tournament",
    starts_at: starts,
    ends_at: null,
    delay_minutes: 0,
    location: "Stage",
    visibility: "public",
    ...extra,
  });
  const facts = (next: AgendaItem[]): ZoneFacts => ({
    now: new Date("2026-01-01T19:00:00Z"),
    timeZone: "UTC",
    origin: "https://event.example",
    eventName: "Demo",
    logoUrl: null,
    agenda: { current: [], next },
    venue: null,
    ticker: { text: null, until: null, source: null },
  });

  it("adds the kind, the description, no game yet and the chip of an earlier next item", () => {
    const semis = item("semis", "2026-01-01T20:00:00Z");
    const final = item("final", "2026-01-01T21:15:00Z", { description: "Best of three" });
    const view = countdownFields(facts([semis, final]), "final");
    expect(view).toMatchObject({
      label: "Item final",
      kind: "tournament",
      description: "Best of three",
      game: null,
      chip: { label: "Item semis", target_at: "2026-01-01T20:00:00Z" },
    });
    expect(view).not.toHaveProperty("teams_left");
  });

  it("has no chip when the countdown holds the next item itself", () => {
    const semis = item("semis", "2026-01-01T20:00:00Z");
    expect(countdownFields(facts([semis]))?.chip).toBeNull();
    expect(countdownFields(facts([semis]))?.description).toBeNull();
  });
});
