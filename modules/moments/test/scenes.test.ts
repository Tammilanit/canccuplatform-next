/**
 * Scenes, pure (contracts/moments.md, Scenes): the presets against step 3's "follow the day" on
 * the shared fixture, the conditions, first match wins, hold, the crew button, the heartbeat, the
 * band chart and the checks of an organiser's scene.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRESETS, checkScenes, sceneEvent } from "../src/scenes.js";
import type { Scene } from "../src/scenes.js";
import { bandsOf, heartbeatOf, pickScene } from "../src/scene-eval.js";
import { chartSpan } from "../src/scene-pages.js";
import type { SceneFacts } from "../src/scene-eval.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../../contracts/moments/follow-the-day.json", import.meta.url), "utf8"),
) as {
  items: SceneFacts["items"];
  scenes: Record<string, Record<string, unknown>>;
  cases: { zone: string; at: string; phase: string; scene: string }[];
};

const facts = (at: string | number, o: Partial<SceneFacts> = {}): SceneFacts => ({
  now: typeof at === "number" ? at : Date.parse(at),
  timeZone: "UTC",
  items: fixture.items,
  checkinsLastHour: 0,
  online: null,
  surging: false,
  crew: null,
  ...o,
});

const scene = (key: string, o: Partial<Scene> = {}): Scene => ({
  key,
  name: key,
  preset: null,
  zones: [],
  when: [],
  then: {
    motion: null,
    layouts: {},
    stage_mood: null,
    palette: null,
    sound: null,
    quiet: false,
    hero_off: [],
  },
  hold_minutes: 0,
  blend_seconds: 0,
  ...o,
});

describe("scenes", () => {
  it("reproduce step 3's follow the day with the five presets, on the shared fixture", () => {
    expect(PRESETS.map((s) => s.key)).toEqual(["quiet", "wind_down", "doors", "peak", "daytime"]);
    for (const c of fixture.cases) {
      const picked = pickScene(PRESETS, facts(c.at), c.zone, null);
      expect(picked?.scene.key, `${c.zone} at ${c.at}`).toBe(c.scene);
      expect(sceneEvent(picked?.scene ?? null, c.zone)).toEqual(fixture.scenes[c.scene]);
    }
  });

  it("takes the first scene whose conditions hold, any of them being enough", () => {
    const late = scene("late", { when: [{ type: "time", from: "22:00", to: "03:00" }] });
    const busy = scene("busy", {
      when: [
        { type: "presence", over: 150 },
        { type: "checkins", over: 30 },
      ],
    });
    const hot = scene("hot", { when: [{ type: "games" }] });
    const always = scene("always");
    const list = [late, busy, hot, always];
    const key = (f: SceneFacts) => pickScene(list, f, "main", null)?.scene.key;
    expect(key(facts("2026-03-13T23:00:00Z"))).toBe("late");
    expect(key(facts("2026-03-14T02:59:00Z"))).toBe("late");
    expect(key(facts("2026-03-14T03:00:00Z"))).toBe("always");
    expect(key(facts("2026-03-13T12:00:00Z", { online: 151 }))).toBe("busy");
    expect(key(facts("2026-03-13T12:00:00Z", { online: 150 }))).toBe("always");
    expect(key(facts("2026-03-13T12:00:00Z", { checkinsLastHour: 31 }))).toBe("busy");
    expect(key(facts("2026-03-13T12:00:00Z", { surging: true }))).toBe("hot");
    // Presence never holds while no count is known: "under 40" is not "nobody online".
    const empty = scene("empty", { when: [{ type: "presence", under: 40 }] });
    expect(pickScene([empty], facts("2026-03-13T12:00:00Z"), "main", null)).toBeNull();
    expect(
      pickScene([empty], facts("2026-03-13T12:00:00Z", { online: 3 }), "main", null),
    ).not.toBeNull();
  });

  // #592: without the event's dates the chart draws the event's own day, not UTC's.
  it("draws today in the event's time zone when the event has no dates", () => {
    expect(chartSpan(null, new Date("2026-03-13T23:30:00Z"), "Europe/Helsinki")).toEqual({
      from: Date.parse("2026-03-13T22:00:00Z"),
      to: Date.parse("2026-03-14T22:00:00Z"),
    });
  });

  // #592 (E7): a press lasts until its time ends or it is pressed again, never its hold on top.
  it("holds no scene the crew pressed once the press is over", () => {
    const pressed = scene("pressed", { when: [{ type: "crew", minutes: 30 }], hold_minutes: 20 });
    const rest = scene("rest");
    const since = Date.parse("2026-03-13T12:00:00Z");
    const current = { key: "pressed", since, crew: true };
    expect(pickScene([pressed, rest], facts(since + 60_000), "main", current)?.scene.key).toBe(
      "rest",
    );
  });

  it("keeps a scene for its hold time, unless one higher in the list holds", () => {
    const top = scene("top", { when: [{ type: "games" }] });
    const held = scene("held", { when: [{ type: "checkins", over: 30 }], hold_minutes: 20 });
    const rest = scene("rest");
    const list = [top, held, rest];
    const since = Date.parse("2026-03-13T12:00:00Z");
    const current = { key: "held", since };
    expect(pickScene(list, facts(since + 19 * 60_000), "main", current)?.scene.key).toBe("held");
    expect(pickScene(list, facts(since + 20 * 60_000), "main", current)?.scene.key).toBe("rest");
    expect(
      pickScene(list, facts(since + 60_000, { surging: true }), "main", current)?.scene.key,
    ).toBe("top");
  });

  it("lets the crew button win until its time ends, on its zones", () => {
    const peak = PRESETS.find((s) => s.key === "peak") as Scene;
    expect(peak.when).toContainEqual({ type: "crew", minutes: 30 });
    const at = Date.parse("2026-03-13T11:00:00Z");
    const crew = { scene: "peak", until: at + 60_000, zones: ["main"] };
    const on = pickScene(PRESETS, facts(at, { crew }), "main", null);
    expect(on).toMatchObject({ scene: { key: "peak" }, crew: true });
    expect(pickScene(PRESETS, facts(at, { crew }), "stage", null)?.scene.key).toBe("daytime");
    expect(pickScene(PRESETS, facts(at + 60_000, { crew }), "main", null)?.scene.key).toBe(
      "daytime",
    );
  });

  it("applies a scene only on its zones, and an agenda condition only to the zone's items", () => {
    const stageOnly = scene("stage_only", { zones: ["stage"] });
    expect(pickScene([stageOnly], facts("2026-03-13T11:00:00Z"), "main", null)).toBeNull();
    const soon = scene("soon", {
      when: [{ type: "agenda", kinds: ["tournament"], starts_within_minutes: 30 }],
    });
    expect(pickScene([soon], facts("2026-03-13T17:30:00Z"), "main", null)?.scene.key).toBe("soon");
    expect(pickScene([soon], facts("2026-03-13T17:30:00Z"), "stage", null)).toBeNull();
    expect(pickScene([soon], facts("2026-03-13T18:00:00Z"), "main", null)).toBeNull();
  });

  it("sends a zone its own layout and the scene's other changes", () => {
    const s = scene("look", {
      then: {
        motion: "party",
        layouts: { main: "dashboard" },
        stage_mood: "peak",
        palette: { primary: "#112233" },
        sound: false,
        quiet: false,
        hero_off: ["playlist"],
      },
      blend_seconds: 30,
    });
    expect(sceneEvent(s, "main")).toMatchObject({
      layout: "dashboard",
      palette: { primary: "#112233" },
      sound: false,
      hero_off: ["playlist"],
      blend_seconds: 30,
    });
    expect(sceneEvent(s, "stage")?.layout).toBeNull();
  });

  it("beats faster as the event gets busier, never outside 4 to 30 a minute", () => {
    const at = "2026-03-13T11:00:00Z";
    expect(heartbeatOf("build_up", facts(at))).toBe(8);
    expect(heartbeatOf("quiet_hours", facts(at))).toBe(4);
    expect(heartbeatOf("peak", facts(at))).toBe(12);
    expect(heartbeatOf("build_up", facts(at, { checkinsLastHour: 25 }))).toBe(13);
    expect(heartbeatOf("build_up", facts(at, { checkinsLastHour: 25, online: 120 }))).toBe(15);
    expect(heartbeatOf("peak", facts(at, { checkinsLastHour: 900 }))).toBe(30);
  });

  it("draws the band chart of each day from the time and agenda conditions alone", () => {
    const late = scene("late", { when: [{ type: "time", from: "22:00", to: "03:00" }] });
    const busy = scene("busy", { when: [{ type: "presence", over: 1 }] });
    const day = scene("day");
    const days = bandsOf([late, busy, day], {
      timeZone: "UTC",
      items: [],
      zone: "main",
      from: Date.parse("2026-03-13T09:00:00Z"),
      to: Date.parse("2026-03-14T12:00:00Z"),
    });
    expect(days.map((d) => d.date)).toEqual(["2026-03-13", "2026-03-14"]);
    expect(days[0]?.bands).toEqual([
      { from: "09:00", to: "22:00", scene: "day" },
      { from: "22:00", to: "24:00", scene: "late" },
    ]);
    expect(days[1]?.bands).toEqual([
      { from: "00:00", to: "03:00", scene: "late" },
      { from: "03:00", to: "12:00", scene: "day" },
    ]);
  });

  it("refuses a scene list with a bad key, condition or change", () => {
    expect(checkScenes(PRESETS)).toBeNull();
    expect(checkScenes([scene("Bad Key")])).toMatch(/key/);
    expect(checkScenes([scene("a1"), scene("a1")])).toMatch(/once/);
    expect(
      checkScenes([scene("t1", { when: [{ type: "time", from: "25:00", to: "03:00" }] })]),
    ).toMatch(/time/);
    expect(checkScenes([scene("t2", { when: [{ type: "weather" } as never] })])).toMatch(
      /condition/,
    );
    expect(
      checkScenes([scene("p1", { then: { ...scene("x").then, palette: { primary: "red" } } })]),
    ).toMatch(/colour/);
    expect(
      checkScenes([scene("h1", { then: { ...scene("x").then, hero_off: ["slides"] } })]),
    ).toMatch(/hero/);
    expect(checkScenes([scene("c1", { when: [{ type: "crew", minutes: 0 }] })])).toMatch(/crew/);
    expect(checkScenes([scene("m1", { hold_minutes: 241 })])).toMatch(/hold/);
  });
});
