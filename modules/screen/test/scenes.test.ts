/**
 * Scenes on Screen (contracts/screen.md, Motion and burn-in drift; D5): the presets against step
 * 3's "follow the day" on the fixture Moments' tests share, a scene's level, stage mood, layout
 * and hero features, and Screen's copy of `moments.scene.changed`, with the phase as the fallback.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newId, withTenant } from "@canccu/kit";
import type { Event } from "@canccu/kit";
import { buildRegions } from "../src/compose/build.js";
import { displayOf, moodOf } from "../src/compose/display.js";
import { phaseAt, phaseItems } from "../src/compose/motion.js";
import type { MotionLevel } from "../src/compose/motion.js";
import { applySceneEvent, sceneOf } from "../src/compose/scenes.js";
import type { ZoneScene } from "../src/compose/scenes.js";
import type { AgendaItem, ZoneFacts } from "../src/compose/widgets.js";
import { DATABASE_URL, call, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../../contracts/moments/follow-the-day.json", import.meta.url), "utf8"),
) as {
  items: Record<string, unknown>[];
  scenes: Record<string, Record<string, unknown>>;
  cases: { zone: string; at: string; phase: string; scene: string }[];
};
// The agenda's fields Screen reads besides those the fixture names.
const ITEMS = fixture.items.map(
  (i) => ({ title: String(i.id), delay_minutes: 0, location: null, ...i }) as AgendaItem,
);

const settings = (values: Record<string, unknown>) => ({
  get: (key: string, fallback: unknown) => values[key] ?? fallback,
});
const LEVELS: MotionLevel[] = ["none", "calm", "lively", "party"];

/** A scene as Screen keeps it from the event's data. */
const scene = (key: string, over: Record<string, unknown> = {}): ZoneScene =>
  sceneOf({
    zone_key: "main",
    scene: { ...(fixture.scenes[key] ?? fixture.scenes.daytime), ...over },
    since: "2026-03-13T10:00:00Z",
    why: "always",
    heartbeat_bpm: 8,
  }) as ZoneScene;

describe("scenes and follow the day", () => {
  it("compose the display the presets send exactly as the day's phase does", () => {
    for (const c of fixture.cases) {
      const at = Date.parse(c.at);
      const items = phaseItems(ITEMS, c.zone);
      expect(phaseAt(items, at), `${c.zone} at ${c.at}`).toBe(c.phase);
      const sent = scene(c.scene);
      expect(moodOf(sent, phaseAt(items, at))).toBe(c.phase);
      for (const level of LEVELS)
        for (const follow of [true, false])
          for (const pin of [null, "calm", "party"] as const)
            for (const motion of ["moderate", "calm", "none"]) {
              const input = {
                tokens: { motion },
                items,
                pin,
                settings: settings({ motion_level: level, follow_the_day: follow }),
                at,
              };
              const byPhase = displayOf(input).display;
              const { scene: drawn, ...byScene } = displayOf({ ...input, scene: sent }).display;
              expect(
                byScene,
                `${c.at} ${level} ${String(follow)} ${String(pin)} ${motion}`,
              ).toEqual(byPhase);
              expect(drawn).toMatchObject({ key: c.scene, heartbeat_bpm: 8 });
            }
    }
  });

  it("sets a level, quiets it, and leaves a pinned zone or one not following alone", () => {
    const at = Date.parse("2026-03-13T11:00:00Z");
    const level = (s: ZoneScene, o: { pin?: MotionLevel | null; follow?: boolean } = {}) =>
      displayOf({
        tokens: {},
        items: [],
        pin: o.pin ?? null,
        settings: settings({ follow_the_day: o.follow ?? true }),
        at,
        scene: s,
      }).display.motion_level;
    expect(level(scene("daytime", { motion: "party" }))).toBe("party");
    expect(level(scene("daytime", { motion: "none" }))).toBe("none");
    expect(level(scene("daytime", { motion: "party" }), { pin: "calm" })).toBe("calm");
    expect(level(scene("daytime", { motion: "party" }), { follow: false })).toBe("lively");
    expect(level(scene("daytime", { motion: "party", quiet: true }))).toBe("calm");
    expect(level(scene("daytime", { quiet: true }), { pin: "party" })).toBe("calm");
  });

  it("hands the player the scene's look, and draws nothing new without one", () => {
    const at = Date.parse("2026-03-13T11:00:00Z");
    const base = { tokens: {}, items: [], pin: null, settings: settings({}), at };
    expect(displayOf(base).display).not.toHaveProperty("scene");
    const s = scene("daytime", {
      palette: { primary: "#112233" },
      sound: false,
      quiet: true,
      blend_seconds: 30,
    });
    expect(displayOf({ ...base, scene: s }).display.scene).toEqual({
      key: "daytime",
      name: "Daytime",
      since: "2026-03-13T10:00:00Z",
      palette: { primary: "#112233" },
      sound: false,
      quiet: true,
      blend_seconds: 30,
      heartbeat_bpm: 8,
    });
  });

  it("switches the hero's features off and takes the scene's layout for the zone", () => {
    const facts: ZoneFacts = {
      now: new Date("2026-01-01T12:00:07Z"),
      timeZone: "UTC",
      origin: "https://demo.example",
      eventName: "Demo Event",
      logoUrl: null,
      agenda: { current: [], next: [] },
      venue: null,
      ticker: { text: null, until: null, source: null },
    };
    const zone = { key: "main", layoutId: null, regions: { hero: { skip_empty: false } } };
    const build = (o: { heroOff?: string[]; sceneLayoutId?: string | null } = {}) =>
      buildRegions({ zone, windowLayoutId: null, themeLayouts: [], portrait: false, facts, ...o });
    const hero = (o: Parameters<typeof build>[0]) =>
      build(o).regions.find((r) => r.id === "hero")?.order;
    expect(hero({})).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(hero({ heroOff: ["playlist", "countdown"] })).toEqual([1, 2, 3, 4, 5, 7]);
    expect(build({ sceneLayoutId: "ambient" }).layout.id).toBe("ambient");
    expect(build({ sceneLayoutId: "no_such_layout" }).layout.id).toBe("pulse");
    expect(
      buildRegions({
        zone,
        windowLayoutId: "hero",
        themeLayouts: [],
        portrait: false,
        facts,
        sceneLayoutId: "ambient",
      }).layout.id,
    ).toBe("hero");
  });
});

interface State {
  layout: { id: string };
  display: {
    motion_level: string;
    stage?: { phase: string };
    scene?: Record<string, unknown>;
  };
}

describe.skipIf(!DATABASE_URL)("Screen's copy of the scenes", () => {
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
    data: {
      zone_key: "main",
      since: "2026-01-01T12:00:00Z",
      why: "always",
      heartbeat_bpm: 12,
      actor_user_id: null,
      ...data,
    },
  });
  const apply = (e: Event) => withTenant("alpha", () => applySceneEvent(h.db, e));
  const state = async () =>
    (
      await call(h, "GET", "/api/screen/device/state", { cookies: { canccu_device: token } })
    ).json<State>();

  it("follows the day until a scene is known, then the scene, and keeps the newest", async () => {
    const before = await state();
    expect(before.display.motion_level).toBe("lively");
    expect(before.display.scene).toBeUndefined();
    const party = changed({
      scene: { ...fixture.scenes.peak, motion: "party", layout: "dashboard" },
    });
    const day = changed({ scene: fixture.scenes.daytime });
    await apply(party);
    const peak = await state();
    expect(peak.display.motion_level).toBe("party");
    expect(peak.display.stage?.phase).toBe("peak");
    expect(peak.layout.id).toBe("dashboard");
    expect(peak.display.scene).toMatchObject({ key: "peak", heartbeat_bpm: 12 });
    // The Motion card says the level the scene gives; Moments, not the phase, knows the next.
    const card = (await call(h, "GET", "/api/screen/motion", { session: "admin" })).json<{
      zones: { key: string; level: string; next: unknown }[];
    }>();
    expect(card.zones.find((z) => z.key === "main")).toMatchObject({ level: "party", next: null });
    await apply(day);
    // A replay from the stream's start: the older event loses.
    await apply(party);
    const after = await state();
    expect(after.display.scene).toMatchObject({ key: "daytime" });
    expect(after.layout.id).toBe("pulse");
    // No scene holds: the day's phase again.
    await apply(changed({ scene: null }));
    expect((await state()).display.scene).toBeUndefined();
  });
});
