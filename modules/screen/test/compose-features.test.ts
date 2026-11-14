import { describe, expect, it } from "vitest";
import { buildRegions } from "../src/compose/build.js";
import { highlightChangeAt, highlightOf } from "../src/compose/features.js";
import { BUILT_IN_LAYOUTS } from "../src/compose/layouts.js";
import { hourlyOf } from "../src/compose/stats.js";
import type { PresenceCount } from "../src/compose/stats.js";
import { isWaiting } from "../src/compose/waiting.js";
import { viewOf } from "../src/compose/widgets.js";
import type { AgendaItem, ZoneFacts } from "../src/compose/widgets.js";

// The hero's own features and the Dashboard's boxes (contracts/screen.md, The Director and
// Widgets; design guideline sheets 10 and 13).
const NOW = Date.parse("2026-03-14T18:42:00Z");
const HOUR = 3600_000;

const item = (id: string, startsIn: number, kind: string): AgendaItem => ({
  id,
  title: `Item ${id}`,
  kind,
  starts_at: new Date(NOW + startsIn).toISOString(),
  ends_at: null,
  delay_minutes: 0,
  location: "Stage",
  visibility: "public",
  status: "scheduled",
  zone: null,
});

function facts(over: Partial<ZoneFacts> = {}): ZoneFacts {
  return {
    now: new Date(NOW),
    timeZone: "UTC",
    origin: "https://demo.example",
    eventName: "Demo Event",
    logoUrl: null,
    agenda: { current: [], next: [item("semis", HOUR, "tournament")] },
    venue: null,
    ticker: { text: null, until: null, source: null },
    ...over,
  };
}

const count = (hoursAgo: number, online: number, inVoice = 10): PresenceCount => ({
  at: NOW - hoursAgo * HOUR,
  interval_seconds: 60,
  members: 300,
  online,
  in_voice: inVoice,
});

describe("tonight's highlight", () => {
  it("is the next tournament or ceremony of the next 12 hours", () => {
    const items = [
      item("dinner", 10 * 60_000, "meal"),
      item("final", 3 * HOUR, "tournament"),
      item("prizes", 4 * HOUR, "ceremony"),
    ];
    expect(highlightOf(items, NOW)?.id).toBe("final");
    expect(highlightOf([item("late", 13 * HOUR, "ceremony")], NOW)).toBeNull();
    expect(highlightOf([item("over", -HOUR, "tournament")], NOW)).toBeNull();
  });

  it("names when it next changes: the highlight's start, or a big item entering the 12 hours", () => {
    const final = item("final", 3 * HOUR, "tournament");
    const late = item("late", 13 * HOUR, "ceremony");
    // The final leaves at its start, before the ceremony enters the window an hour from now.
    expect(highlightChangeAt([final, late], NOW)).toBe(NOW + HOUR);
    expect(highlightChangeAt([final], NOW)).toBe(NOW + 3 * HOUR);
    // At each of those times the answer does change.
    expect(highlightOf([late], NOW + HOUR)?.id).toBe("late");
    expect(highlightOf([final], NOW + 3 * HOUR)).toBeNull();
    expect(
      highlightChangeAt([item("dinner", HOUR, "meal"), item("over", -HOUR, "tournament")], NOW),
    ).toBeNull();
  });

  it("draws as the Pulse hero's countdown of that item, marked as the highlight", () => {
    const final = item("final", 3 * HOUR, "tournament");
    const view = viewOf("countdown", { highlight: true }, facts({ highlight: final }));
    expect(view).toMatchObject({
      empty: false,
      highlight: true,
      label: "Item final",
      target_at: final.starts_at,
      kind: "tournament",
      // The next item starts first, so the hero still says when.
      chip: { label: "Item semis" },
    });
    expect(viewOf("countdown", { highlight: true }, facts({ highlight: null })).empty).toBe(true);
    expect(viewOf("countdown", {}, facts({ highlight: final })).label).toBe("Item semis");
  });
});

describe("today in numbers", () => {
  const presence = {
    online: hourlyOf([count(5, 100), count(3, 231), count(1, 212)], (c) => c.online, "UTC", NOW),
    in_voice: [],
    online_peak: { count: 231, at: new Date(NOW - 3 * HOUR).toISOString(), time_text: "15:42" },
  };

  it("adds up the last 24 hours at wind-down only", () => {
    const view = viewOf(
      "today_numbers",
      {},
      facts({ phase: "wind_down", presence, photosToday: 38 }),
    );
    expect(view).toMatchObject({
      empty: false,
      title: "Today in numbers",
      day_text: "Saturday",
      online_peak: { count: 231, time_text: "15:42" },
      photos: 38,
    });
    expect(view.points).toEqual([
      { time_text: "13:00", value: 100, level: 3 },
      // "Today in numbers" labels every third hour: the hero panel is wider than a box.
      { time_text: "15:00", value: 231, level: 8, tick_text: "15:00" },
      { time_text: "17:00", value: 212, level: 7 },
    ]);
    expect(view.scale).toEqual([{ value: 300 }, { value: 200 }, { value: 100 }, { value: 0 }]);
    expect(viewOf("today_numbers", {}, facts({ phase: "peak", presence })).empty).toBe(true);
  });

  it("has nothing to show without a count or a photo", () => {
    const none = { online: [], in_voice: [] };
    const view = viewOf("today_numbers", {}, facts({ phase: "wind_down", presence: none }));
    expect(view.empty).toBe(true);
    const photos = viewOf("today_numbers", {}, facts({ phase: "wind_down", photosToday: 4 }));
    expect(photos).toMatchObject({ empty: false, photos: 4 });
    expect(photos.online_peak).toBeUndefined();
  });
});

describe("the activity graph", () => {
  it("averages each hour of the last 24", () => {
    const points = hourlyOf(
      [count(26, 999), count(2.5, 100), count(2.2, 120), count(0.5, 220)],
      (c) => c.online,
      "Europe/Helsinki",
      NOW,
    );
    expect(points).toEqual([
      { time_text: "18:00", value: 110 },
      { time_text: "20:00", value: 220 },
    ]);
  });

  it("draws online or in voice, and waits under three hours of counts", () => {
    const hours = [count(3, 100, 5), count(2, 150, 9), count(1, 200, 12), count(0.5, 230, 12)];
    const presence = {
      online: hourlyOf(hours, (c) => c.online, "UTC", NOW),
      in_voice: hourlyOf(hours, (c) => c.in_voice, "UTC", NOW),
      in_voice_peak: { count: 12, at: "", time_text: "17:42" },
    };
    const online = viewOf("activity_graph", {}, facts({ presence }));
    expect(online).toMatchObject({ empty: false, metric: "online", label: "Online · 24 h" });
    const voice = viewOf("activity_graph", { metric: "in_voice" }, facts({ presence }));
    expect(voice).toMatchObject({ metric: "in_voice", peak: { count: 12 } });
    expect(voice.scale).toEqual([{ value: 15 }, { value: 10 }, { value: 5 }, { value: 0 }]);
    expect(online.scale).toEqual([{ value: 300 }, { value: 200 }, { value: 100 }, { value: 0 }]);
    // The 24-hour graph labels every sixth hour, on its bar.
    expect(online.points).toEqual([
      { time_text: "15:00", value: 100, level: 3 },
      { time_text: "16:00", value: 150, level: 5 },
      { time_text: "17:00", value: 200, level: 7 },
      { time_text: "18:00", value: 230, level: 8, tick_text: "18:00" },
    ]);
    const two = { online: presence.online.slice(2), in_voice: [] };
    expect(viewOf("activity_graph", {}, facts({ presence: two })).empty).toBe(true);
    expect(viewOf("activity_graph", {}, facts()).empty).toBe(true);
  });
});

describe("the Dashboard", () => {
  it("shows six different boxes, as sheet 10 has them", () => {
    const dashboard = BUILT_IN_LAYOUTS.find((l) => l.id === "dashboard");
    const boxes = dashboard?.regions.filter((r) => !["header", "ticker"].includes(r.id)) ?? [];
    const firsts = boxes.map((r) => r.widgets[0]?.widget);
    expect(firsts).toEqual([
      "playlist",
      "activity_graph",
      "voice_rooms",
      "now_playing",
      "stats",
      "agenda_now",
    ]);
    expect(new Set(firsts).size).toBe(6);
  });

  it("lets the boxes that wait for the bot's data give their cells away", () => {
    const empty = () => true;
    expect(isWaiting([{ widget: "activity_graph" }], "logo", empty)).toBe(true);
    expect(isWaiting([{ widget: "voice_rooms" }], "logo", empty)).toBe(true);
    expect(viewOf("voice_rooms", {}, facts()).empty).toBe(true);
    const zone = { key: "main", layoutId: "dashboard", regions: {} };
    const { regions } = buildRegions({
      zone,
      windowLayoutId: null,
      themeLayouts: [],
      portrait: false,
      facts: facts({ stats: { checked_in: 12 } }),
    });
    const ids = regions.map((r) => r.id);
    expect(ids).not.toContain("online");
    expect(ids).not.toContain("voice");
    expect(ids).toContain("right_now");
  });
});
