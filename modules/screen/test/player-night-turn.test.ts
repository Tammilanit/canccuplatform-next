// @vitest-environment happy-dom
/**
 * The coming hours take their hero turn at night too (#841). PR #832's stack check waited 120 s
 * for them on the Pulse and the Dashboard between 02:05 and 03:25 and never saw them, though the
 * state had `agenda_timeline` in the hero's order. The player was not the cause: its wait looked
 * for a tick *visible*, and a tick is 0 px wide with its time running out of it (timeline.css), so
 * Playwright never counts one as visible and that wait could only time out, at any hour. This
 * holds the rest of the chain at that clock: compose puts a line with items in the hero's order,
 * its window and subtitle agree after midnight, and the player turns the hero to it within a lap.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Screen } from "../player/src/screen.js";
import type { ScreenState } from "../player/src/state.js";
import { buildRegions } from "../src/compose/build.js";
import type { AgendaItem, ZoneFacts } from "../src/compose/widgets.js";
import { placeDay } from "./stack/day.mjs";

const HOUR_MS = 3600_000;

/** The stack fixture's run of show (day.mjs) as the agenda module gives it, seeded at `seeded`. */
function demoAgenda(seeded: number): AgendaItem[] {
  return placeDay(seeded).map((p, n) => ({
    id: `ai_${String(n)}`,
    title: p.title,
    kind: p.kind,
    starts_at: p.starts_at,
    // A delay moves the item's end (the agenda module's rule), as the fixture's delay calls do.
    ends_at: new Date(Date.parse(p.ends_at) + p.delay * 60_000).toISOString(),
    delay_minutes: p.delay,
    location: p.location,
    visibility: "public",
    status: "scheduled",
    zone: null,
  }));
}

function compose(nowMs: number, timeZone: string, layoutId: string) {
  // The screenshot run seeds the run of show at its start, a few minutes before the check.
  const items = demoAgenda(nowMs - 5 * 60_000);
  const runs = (i: AgendaItem) =>
    Date.parse(i.starts_at) <= nowMs && nowMs < Date.parse(i.ends_at ?? i.starts_at);
  const facts: ZoneFacts = {
    now: new Date(nowMs),
    timeZone,
    origin: "https://demo.example",
    eventName: "Demo Event",
    logoUrl: null,
    agenda: {
      current: items.filter(runs),
      next: items.filter((i) => Date.parse(i.starts_at) > nowMs).slice(0, 1),
    },
    venue: null,
    ticker: { text: null, until: null, source: null },
    timeline: items,
  };
  return buildRegions({
    zone: { key: "main", layoutId, regions: {} },
    windowLayoutId: null,
    themeLayouts: [],
    portrait: false,
    facts,
  });
}

// 02:30 in the event's zone: the demo event's own UTC, and a zone two hours ahead, as the issue's
// clock (00:30 UTC) was.
const CLOCKS = [
  { at: "2026-11-28T02:30:00Z", timeZone: "UTC" },
  { at: "2026-11-28T00:30:00Z", timeZone: "Africa/Johannesburg" },
];
const CASES = CLOCKS.flatMap((c) => ["pulse", "dashboard"].map((layoutId) => ({ ...c, layoutId })));

describe("the coming hours at 02:30 with the demo run of show (#841)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(CASES)(
    "$layoutId in $timeZone: composed into the hero's order, window and subtitle agreeing",
    ({ at, timeZone, layoutId }) => {
      const nowMs = Date.parse(at);
      const hero = compose(nowMs, timeZone, layoutId).regions.find((r) => r.role === "hero");
      const index = hero?.widgets.findIndex((w) => w.widget === "agenda_timeline") ?? -1;
      expect(hero?.order).toContain(index);
      const view = hero?.widgets[index]?.view as Record<string, unknown>;
      expect(view.empty).toBe(false);
      expect((view.items as unknown[]).length).toBeGreaterThan(0);
      // The window starts at the event's hour (02:00) and runs past midnight's turn, not to it.
      expect(Date.parse(view.from as string)).toBe(nowMs - 30 * 60_000);
      const hours = view.hours as number;
      expect(Date.parse(view.to as string) - Date.parse(view.from as string)).toBe(hours * HOUR_MS);
      expect(view.subtitle).toBe(`The next ${String(hours)} hours`);
    },
  );

  it.each(CASES)("$layoutId in $timeZone: the player gives them their turn", (c) => {
    const nowMs = Date.parse(c.at);
    vi.useFakeTimers({ now: nowMs });
    const { layout, regions } = compose(nowMs, c.timeZone, c.layoutId);
    const hero = regions.find((r) => r.role === "hero");
    const lapMs = (hero?.order ?? []).reduce(
      (sum, i) => sum + (hero?.widgets[i]?.dwell_seconds ?? 0) * 1000,
      0,
    );
    const state = {
      state_version: 3,
      time: c.at,
      tenant: { id: "demo", name: "Demo Event", time_zone: c.timeZone, status: "live" },
      device: { id: "dv_1", name: "Hall left", mirror: false },
      zone: { key: "main", name: "Main hall", epoch: "e1" },
      bundle: { version: "1.0.0" },
      theme: { revision: 1, tokens_css_url: null, css_url: null, logo_url: null, templates: [] },
      layout,
      regions,
      ticker: null,
      display: { motion: "calm", drift: false },
    } as unknown as ScreenState;
    const screen = new Screen({ serverNow: () => Date.now(), reducedMotion: () => false });
    const root = screen.draw(state);
    const active = ".canccu-region--hero > .canccu-widget--agenda_timeline.canccu-is-active";
    let turned = root.querySelector(active) !== null;
    // One lap and the choreographer's few seconds: the line's turn comes in it, wherever it starts.
    for (let s = 0; s <= lapMs / 1000 + 5 && !turned; s++) {
      vi.advanceTimersByTime(1000);
      screen.tick();
      turned = root.querySelector(active) !== null;
    }
    expect(lapMs).toBeGreaterThan(0);
    expect(turned).toBe(true);
    expect(root.querySelectorAll(`${active} .canccu-widget__tick`).length).toBeGreaterThan(0);
  });
});
