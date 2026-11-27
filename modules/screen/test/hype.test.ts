/**
 * The hype on Screen (#787 D12, D13; contracts/screen.md, Motion and burn-in drift): the level the
 * screen draws follows the hype Moments sends, under the level Screen composed without it (the
 * ceiling), on the case file Moments' tests share; `display.hype`; the Motion card's `ceiling`.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newId, withTenant } from "@canccu/kit";
import type { Event } from "@canccu/kit";
import { displayOf } from "../src/compose/display.js";
import type { MotionLevel } from "../src/compose/motion.js";
import { applySceneEvent, hypeOf, sceneOf } from "../src/compose/scenes.js";
import type { ZoneHype, ZoneScene } from "../src/compose/scenes.js";
import type { AgendaItem } from "../src/compose/widgets.js";
import { DATABASE_URL, call, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../../contracts/moments/hype.json", import.meta.url), "utf8"),
) as {
  cases: {
    zone: string;
    at: string;
    hype: { level: number; phase: string; item: string | null };
    levels: Record<MotionLevel, MotionLevel>;
  }[];
};

const settings = (values: Record<string, unknown>) => ({
  get: (key: string, fallback: unknown) => values[key] ?? fallback,
});
const AT = Date.parse("2026-03-13T11:00:00Z");
const sent = (level: number, phase = "building"): ZoneHype =>
  hypeOf({ level, phase, item: null }) as ZoneHype;

const level = (
  hype: ZoneHype | null,
  o: {
    event?: MotionLevel;
    pin?: MotionLevel | null;
    follow?: boolean;
    items?: AgendaItem[];
    scene?: ZoneScene | null;
  } = {},
) =>
  displayOf({
    tokens: {},
    items: o.items ?? [],
    pin: o.pin ?? null,
    settings: settings({ motion_level: o.event ?? "party", follow_the_day: o.follow ?? true }),
    at: AT,
    scene: o.scene ?? null,
    hype,
  }).display.motion_level;

describe("the level follows the hype", () => {
  it("moves from calm up to the ceiling, never over it, on the shared cases", () => {
    for (const c of fixture.cases) {
      const hype = hypeOf({
        ...c.hype,
        item: c.hype.item === null ? null : { id: c.hype.item, title: "Demo Cup", kind: "tournament", starts_at: c.at, ends_at: null },
      }); // prettier-ignore
      for (const [ceiling, want] of Object.entries(c.levels))
        expect(level(hype, { event: ceiling as MotionLevel }), `${c.zone} ${c.at} ${ceiling}`).toBe(
          want,
        );
    }
  });

  it("is calm under 0.35, lively up to 0.7 and party above", () => {
    expect(level(sent(0.3))).toBe("calm");
    expect(level(sent(0.35))).toBe("lively");
    expect(level(sent(0.65))).toBe("lively");
    expect(level(sent(0.7))).toBe("party");
  });

  it("leaves a pinned zone, one not following the day and quiet hours alone", () => {
    expect(level(sent(1), { pin: "calm" })).toBe("calm");
    expect(level(sent(0), { pin: "party" })).toBe("party");
    expect(level(sent(0), { follow: false, event: "lively" })).toBe("lively");
    const night: AgendaItem = {
      id: "ai_night",
      title: "Quiet hours",
      kind: "quiet_hours",
      zone: null,
      visibility: "public",
      status: "scheduled",
      starts_at: "2026-03-13T10:00:00Z",
      ends_at: "2026-03-13T12:00:00Z",
      delay_minutes: 0,
      location: null,
    } as AgendaItem;
    expect(level(sent(1), { items: [night] })).toBe("calm");
    const quiet = sceneOf({ scene: { key: "quiet", quiet: true, motion: null } });
    expect(level(sent(1), { scene: quiet })).toBe("calm");
  });

  it("keeps the ceiling without a hype, as a Moments that predates it sends none", () => {
    expect(level(null, { event: "lively" })).toBe("lively");
  });

  it("hands the player the hype, and nothing without one", () => {
    const input = { tokens: {}, items: [], pin: null, settings: settings({}), at: AT };
    expect(displayOf(input).display).not.toHaveProperty("hype");
    expect(displayOf({ ...input, hype: sent(0.55) }).display.hype).toEqual({
      level: 0.55,
      phase: "building",
      item: null,
    });
  });

  it("reads only a well-formed hype from the event", () => {
    expect(hypeOf({ level: 2, phase: "live", item: null })).toEqual({
      level: 1,
      phase: "live",
      item: null,
    });
    expect(hypeOf({ level: 0.5, phase: "loud", item: null })).toBeNull();
    expect(hypeOf("loud")).toBeNull();
    expect(hypeOf({ level: 0.5, phase: "live", item: { id: 7 } })).toEqual({
      level: 0.5,
      phase: "live",
      item: null,
    });
  });
});

describe.skipIf(!DATABASE_URL)("Screen's copy of the hype", () => {
  let h: Harness;
  let token = "";
  beforeAll(async () => {
    h = await harness();
    h.sources.event = { name: "Demo Event" };
    h.sources.agenda = { current: [], next: [] };
    const device = await pairDevice(h);
    token = device.token;
    await call(h, "GET", "/api/screen/zones", { session: "admin" });
    await call(h, "PUT", `/api/screen/devices/${device.id}/assignment`, {
      session: "admin",
      body: { zone_key: "main" },
    });
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    h.clock.now = Date.parse("2026-01-01T12:01:00Z");
    await withTenant("alpha", () => h.db.tenant((c) => c.query("DELETE FROM screen_scenes")));
  });

  const changed = (data: Record<string, unknown>): Event => ({
    id: newId(),
    type: "moments.scene.changed",
    version: 1,
    time: new Date(h.clock.now).toISOString(),
    source: "moments",
    tenant: "alpha",
    data: { zone_key: "main", since: "2026-01-01T12:00:00Z", why: "always", heartbeat_bpm: 8, ...data },
  }); // prettier-ignore
  const apply = (e: Event) => withTenant("alpha", () => applySceneEvent(h.db, e));

  it("keeps the hype with no scene too, and the Motion card names the ceiling", async () => {
    await apply(changed({ scene: null, hype: { level: 0.2, phase: "quiet", item: null } }));
    const state = (
      await call(h, "GET", "/api/screen/device/state", { cookies: { canccu_device: token } })
    ).json<{ display: { motion_level: string; hype?: unknown } }>();
    expect(state.display.motion_level).toBe("calm");
    expect(state.display.hype).toEqual({ level: 0.2, phase: "quiet", item: null });
    const card = (await call(h, "GET", "/api/screen/motion", { session: "admin" })).json<{
      zones: { key: string; level: string; ceiling: string }[];
    }>();
    expect(card.zones.find((z) => z.key === "main")).toMatchObject({
      level: "calm",
      ceiling: "lively",
    });
  });
});
