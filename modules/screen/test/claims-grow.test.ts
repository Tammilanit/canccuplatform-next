/**
 * The grow rule and the ticker under a full screen (contracts/screen.md, Moments drive it: claims;
 * #780): an Important announcement asks for a hero of at least 35 % of the screen, grown where the
 * zone lets it grow, and a full-screen Info or Important leaves the ticker running.
 */
import { describe, expect, it } from "vitest";
import type { BuildInput } from "../src/compose/build.js";
import { overrideOf } from "../src/compose/claims.js";
import type { Override } from "../src/compose/claims.js";
import type { Layout } from "../src/compose/layouts.js";
import type { ZoneFacts } from "../src/compose/widgets.js";
import { placeZone } from "../src/compose/zone-claims.js";

const NOW = new Date("2026-01-01T19:30:10Z");

function facts(over: Partial<ZoneFacts> = {}): ZoneFacts {
  return {
    now: NOW,
    timeZone: "Europe/Helsinki",
    origin: "https://demo.example",
    eventName: "Demo Event",
    logoUrl: null,
    agenda: { current: [], next: [] },
    venue: null,
    ticker: { text: null, until: null, source: null },
    ...over,
  };
}

function input(layoutId: string, over: Partial<BuildInput> = {}): Omit<BuildInput, "showcase"> {
  return {
    zone: { key: "main", regions: {}, layoutId },
    windowLayoutId: null,
    themeLayouts: [],
    portrait: layoutId === "pulse_portrait",
    facts: facts(),
    ...over,
  };
}

function override(id: string, over: Record<string, unknown> = {}): Override {
  const parsed = overrideOf({
    id,
    kind: "block",
    zones: [],
    rank: 80,
    source: { module: "moments", event_id: null, ref: null },
    template: "announcement",
    content: { title: id, body: "", level: "important", starts_at: "2026-01-01T19:30:00Z" },
    starts_at: "2026-01-01T19:30:00Z",
    ends_at: null,
    ...over,
  });
  if (parsed === null) throw new Error(`fixture ${id} does not parse`);
  return parsed;
}

const important = (over: Record<string, unknown> = {}) =>
  override("ov_imp", {
    regions: ["hero", "full", "rail", "ticker"],
    hero_min_share: 0.35,
    ...over,
  });

/** Dashboard with every box drawn, as when its sources are there: none waits (idle `blank`). */
const drawnDashboard = () =>
  input("dashboard", {
    zone: {
      key: "main",
      layoutId: "dashboard",
      regions: Object.fromEntries(
        ["online", "voice", "top_games", "right_now"].map((id) => [id, { idle: "blank" }]),
      ),
    },
  });

const roleOf = (view: ReturnType<typeof placeZone>, id: string) =>
  view.placed.find((p) => p.override_id === id)?.role;
const regionOf = (view: ReturnType<typeof placeZone>, id: string) =>
  view.regions.find((r) => r.id === id);

describe("the grow rule", () => {
  it.each(["pulse", "split", "hero", "ambient", "pulse_portrait"])(
    "an Important takes the hero of %s, which holds 35 %% of the screen already",
    (layout) => {
      const view = placeZone(input(layout), [important()], true);
      expect(roleOf(view, "ov_imp")).toBe("hero");
    },
  );

  it("grows Dashboard's hero to 2 × 2 boxes for an Important", () => {
    const view = placeZone(drawnDashboard(), [important()], true);
    expect(roleOf(view, "ov_imp")).toBe("hero");
    expect(regionOf(view, "hero")?.area).toMatchObject({ columns: 8, rows: 10 });
    expect(regionOf(view, "online")?.area).toMatchObject({ columns: 4, rows: 5 });
  });

  it("measures Dashboard's hero after its waiting boxes handed it their cells", () => {
    // Its statistics boxes wait for their source and give the kept hero their row: 42 %.
    const view = placeZone(input("dashboard"), [important()], false);
    expect(roleOf(view, "ov_imp")).toBe("hero");
  });

  it("sends an Important full screen on Dashboard when the zone does not let the hero grow", () => {
    const view = placeZone(drawnDashboard(), [important()], false);
    expect(roleOf(view, "ov_imp")).toBe("full");
    expect(regionOf(view, "hero")?.area).toMatchObject({ columns: 4, rows: 5 });
  });

  it("keeps any hero for a claim without the rule, also on Dashboard", () => {
    const view = placeZone(input("dashboard"), [important({ hero_min_share: null })], false);
    expect(roleOf(view, "ov_imp")).toBe("hero");
  });

  it("finds the hero of a custom layout by the role the zone gives its region", () => {
    const custom: Layout = {
      id: "two_up",
      name: "Two up",
      aspect: "16:9",
      grid: { columns: 2, rows: 1 },
      regions: [
        {
          id: "big",
          area: { column: 1, row: 1, columns: 1, rows: 1 },
          widgets: [{ widget: "clock" }],
        },
        {
          id: "side",
          area: { column: 2, row: 1, columns: 1, rows: 1 },
          widgets: [{ widget: "clock" }],
        },
      ],
    };
    const view = placeZone(
      input("two_up", {
        themeLayouts: [custom],
        zone: { key: "main", layoutId: "two_up", regions: { big: { role: "hero" } } },
      }),
      [important()],
      true,
    );
    expect(roleOf(view, "ov_imp")).toBe("hero");
  });

  it("reads the hero as the zone composes it: a hidden hero sends it full screen", () => {
    const view = placeZone(
      input("pulse", {
        zone: { key: "main", layoutId: "pulse", regions: { hero: { hidden: true } } },
      }),
      [important()],
      true,
    );
    expect(roleOf(view, "ov_imp")).toBe("full");
  });

  it("never lets a second Important take the full screen over the first's hero", () => {
    const later = important({ id: "ov_imp2", starts_at: "2026-01-01T19:30:05Z" });
    const view = placeZone(input("pulse"), [important(), later], true);
    expect(roleOf(view, "ov_imp2")).toBe("hero");
    expect(roleOf(view, "ov_imp")).toBe("rail");
    expect(view.hidden).toEqual([]);
  });
});

describe("the ticker under a full screen", () => {
  const line = () =>
    override("ov_line", {
      rank: 10,
      template: "ticker",
      regions: ["ticker"],
      content: { text: "Doors close at 23", until: null, source: "moments" },
    });
  const fullInfo = (over: Record<string, unknown> = {}) =>
    override("ov_full", {
      regions: ["full", "hero", "rail", "ticker"],
      keep_ticker: true,
      content: { title: "Raffle", body: "", level: "info", starts_at: "2026-01-01T19:30:00Z" },
      ...over,
    });

  it("keeps Pulse's ticker drawn and its claim shown, with the full screen above it", () => {
    const view = placeZone(input("pulse"), [fullInfo(), line()], true);
    expect(roleOf(view, "ov_full")).toBe("full");
    expect(roleOf(view, "ov_line")).toBe("ticker");
    expect(view.hidden).not.toContain("ov_line");
    expect(regionOf(view, "ticker")?.claim?.hidden).toBe(false);
    expect(regionOf(view, "_full")?.area).toEqual({ column: 1, row: 1, columns: 12, rows: 11 });
    expect(regionOf(view, "_full")?.claim?.keep_ticker).toBe(true);
  });

  it("keeps the ticker when an Important falls from the hero to the full screen", () => {
    const fallen = important({ keep_ticker: true });
    const view = placeZone(drawnDashboard(), [fallen, line()], false);
    expect(roleOf(view, "ov_imp")).toBe("full");
    expect(roleOf(view, "ov_line")).toBe("ticker");
    expect(view.hidden).not.toContain("ov_line");
    expect(regionOf(view, "_full")?.claim?.keep_ticker).toBe(true);
  });

  it("hides the ticker under the emergency, which covers the whole screen", () => {
    const emergency = override("ov_em", {
      kind: "takeover",
      rank: 100,
      regions: ["full"],
      content: {
        title: "Leave the hall",
        body: "",
        level: "emergency",
        starts_at: "2026-01-01T19:30:00Z",
      },
    });
    const view = placeZone(input("pulse"), [emergency, line()], true);
    expect(view.hidden).toContain("ov_line");
    expect(regionOf(view, "_full")?.area).toEqual({ column: 1, row: 1, columns: 12, rows: 12 });
    expect(regionOf(view, "_full")?.claim).not.toHaveProperty("keep_ticker");
  });

  it("takes the full screen over a higher ticker claim it keeps running", () => {
    const higher = { ...line(), rank: 90 };
    const view = placeZone(input("pulse"), [fullInfo(), higher], true);
    expect(roleOf(view, "ov_full")).toBe("full");
    expect(view.hidden).not.toContain("ov_line");
  });

  it("keeps nothing on a layout without a ticker, and fails on nothing", () => {
    const view = placeZone(input("hero"), [fullInfo(), line()], true);
    expect(roleOf(view, "ov_full")).toBe("full");
    expect(view.unplaced).toContain("ov_line");
    expect(regionOf(view, "_full")?.area).toEqual({ column: 1, row: 1, columns: 12, rows: 12 });
  });

  it("draws a ticker that does not span the screen's edge above the full screen", () => {
    const custom: Layout = {
      id: "half_ticker",
      name: "Half ticker",
      aspect: "16:9",
      grid: { columns: 2, rows: 2 },
      regions: [
        {
          id: "hero",
          area: { column: 1, row: 1, columns: 2, rows: 1 },
          widgets: [{ widget: "clock" }],
        },
        {
          id: "ticker",
          area: { column: 2, row: 2, columns: 1, rows: 1 },
          widgets: [{ widget: "ticker" }],
        },
      ],
    };
    const view = placeZone(
      input("half_ticker", {
        themeLayouts: [custom],
        zone: { key: "main", layoutId: "half_ticker", regions: {} },
      }),
      [fullInfo(), line()],
      true,
    );
    expect(regionOf(view, "_full")?.area).toEqual({ column: 1, row: 1, columns: 2, rows: 2 });
    expect(regionOf(view, "ticker")?.layer).toBe(12);
  });
});
