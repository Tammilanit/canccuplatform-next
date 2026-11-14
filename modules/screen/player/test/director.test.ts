// @vitest-environment happy-dom
// The Director and the choreographer on the screen (contracts/screen.md, The Director; design
// guideline sheet 13): the turn indicator, a queue jump, the pacing of changes, and the hero's
// own features as the player's templates draw them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Choreographer, CHANGE_GAP_MS } from "../src/pacing.js";
import { Screen } from "../src/screen.js";
import type { Region, ScreenState, WidgetState } from "../src/state.js";
import { DEFAULT_TEMPLATES } from "../src/templates.js";
import { renderTree } from "../src/tree.js";
import { screenState } from "./fake.js";

const T0 = Date.parse("2026-03-14T18:00:00Z");

const widget = (type: string, view: Record<string, unknown>, dwell = 10): WidgetState => ({
  widget: type,
  template: null,
  dwell_seconds: dwell,
  view: { qr: null, stale: false, empty: false, ...view },
});
const ticker = (text: string, dwell = 10) => widget("ticker", { text }, dwell);

function region(id: string, over: Partial<Region> = {}): Region {
  return {
    id,
    role: id,
    area: { column: 1, row: 1, columns: 6, rows: 6 },
    layer: 0,
    rotation: "director",
    order: [0, 1],
    cycle_started_at: new Date(T0).toISOString(),
    idle: "logo",
    idle_view: null,
    widgets: [ticker("a"), ticker("b")],
    claim: null,
    ...over,
  };
}

const state = (regions: Region[]): ScreenState =>
  screenState({
    layout: { id: "pulse", aspect: "16:9", grid: { columns: 12, rows: 12 } },
    regions,
    display: { motion: "none", drift: false },
  });

const shownText = (root: ParentNode, id: string): string | undefined =>
  root.querySelector(`.canccu-region--${id} .canccu-widget.canccu-is-active .canccu-widget__line`)
    ?.textContent ?? undefined;

const draw = (type: string, view: Record<string, unknown>): HTMLElement => {
  const box = document.createElement("div");
  box.append(...renderTree(DEFAULT_TEMPLATES[type] ?? [], { qr: null, stale: false, empty: false, ...view }));
  return box;
}; // prettier-ignore

describe("the turn indicator", () => {
  const host = { serverNow: () => Date.now(), reducedMotion: () => false };
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 + 4000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a thin line by default, a ring or nothing as the zone picks", () => {
    const line = new Screen(host).draw(state([region("hero")]));
    expect(line.querySelector(".canccu-rotation__bar")).not.toBeNull();
    expect(line.querySelector(".canccu-rotation--ring")).toBeNull();
    const ring = new Screen(host).draw(state([region("hero", { indicator: "ring" })]));
    expect(ring.querySelector(".canccu-rotation--ring")).not.toBeNull();
    expect(ring.querySelector(".canccu-rotation")?.getAttribute("style")).toContain("0.4");
    const off = new Screen(host).draw(state([region("hero", { indicator: "off" })]));
    expect(off.querySelector(".canccu-rotation")).toBeNull();
  });

  it("follows a queue jump: the surging game shows and its minute fills the line", () => {
    const since = new Date(T0 - 26_000).toISOString();
    const hero = region("hero", {
      order: [0, 1],
      widgets: [
        ticker("a"),
        widget("hot_game", { game: { name: "Demo Game" }, players: 14, since }),
      ],
    });
    const root = new Screen(host).draw(state([hero]));
    expect(root.querySelector(".canccu-region--hero .canccu-widget--hot_game")).not.toBeNull();
    const marks = root.querySelector<HTMLElement>(".canccu-rotation");
    expect(marks?.style.getPropertyValue("--canccu-progress")).toBe("0.5");
    const dots = [...(marks?.querySelectorAll(".canccu-rotation__dot") ?? [])];
    expect(dots.map((d) => d.classList.contains("canccu-is-active"))).toEqual([false, true]);
  });
});

describe("the choreographer", () => {
  it("lets one change through every few seconds, the one waiting longest first", () => {
    const c = new Choreographer();
    expect(c.release(["hero", "rail"], T0)).toBe("hero");
    expect(c.release(["rail"], T0 + 1000)).toBeNull();
    expect(c.release(["venue", "rail"], T0 + 2000)).toBeNull();
    expect(c.release(["venue", "rail"], T0 + CHANGE_GAP_MS)).toBe("rail");
    expect(c.release(["venue"], T0 + 2 * CHANGE_GAP_MS)).toBe("venue");
  });

  it("forgets a change no longer wanted", () => {
    const c = new Choreographer();
    expect(c.release(["hero"], T0)).toBe("hero");
    expect(c.release(["rail"], T0 + 1000)).toBeNull();
    expect(c.release([], T0 + 2000)).toBeNull();
    expect(c.release(["venue", "rail"], T0 + CHANGE_GAP_MS)).toBe("venue");
  });

  it("counts a backwards step of the server clock as elapsed, so the screen never freezes", () => {
    const c = new Choreographer();
    // A fast clock drew the last change; the offset is then corrected ten minutes back.
    expect(c.release(["hero"], T0)).toBe("hero");
    const corrected = T0 - 10 * 60_000;
    expect(c.release(["rail"], corrected)).toBe("rail");
    // From the corrected clock on, the gap holds as before.
    expect(c.release(["venue"], corrected + 1000)).toBeNull();
    expect(c.release(["venue"], corrected + CHANGE_GAP_MS)).toBe("venue");
  });

  describe("on a screen", () => {
    const host = { serverNow: () => Date.now(), reducedMotion: () => false };
    beforeEach(() => {
      vi.useFakeTimers({ now: T0 + 1000 });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("pushes two boxes that would turn together apart by three seconds", () => {
      const screen = new Screen(host);
      const hero = region("hero", { widgets: [ticker("hero 1"), ticker("hero 2")] });
      const rail = region("rail", {
        rotation: "sequence",
        widgets: [ticker("rail 1"), ticker("rail 2")],
      });
      const root = screen.draw(state([hero, rail]));
      expect([shownText(root, "hero"), shownText(root, "rail")]).toEqual(["hero 1", "rail 1"]);
      vi.setSystemTime(T0 + 10_000);
      screen.tick();
      expect([shownText(root, "hero"), shownText(root, "rail")]).toEqual(["hero 2", "rail 1"]);
      vi.setSystemTime(T0 + 12_000);
      screen.tick();
      expect(shownText(root, "rail")).toBe("rail 1");
      vi.setSystemTime(T0 + 13_000);
      screen.tick();
      expect(shownText(root, "rail")).toBe("rail 2");
    });

    it("never holds back a claim: the crew's message shows at once", () => {
      const screen = new Screen(host);
      const hero = region("hero", { widgets: [ticker("hero 1"), ticker("hero 2")] });
      const rail = region("rail", { rotation: "sequence", widgets: [ticker("rail 1")] });
      const root = screen.draw(state([hero, rail]));
      vi.setSystemTime(T0 + 10_000);
      const claim = {
        override_id: "ov_1", hidden: false, role: "rail", rank: 80, template: "announcement",
        content: { title: "Dinner is served", body: "Café", level: "info" }, steps: null, sound: null,
        on_end: "resume", starts_at: new Date(T0 + 9000).toISOString(), ends_at: null, expires_at: null,
      }; // prettier-ignore
      screen.draw(state([hero, { ...rail, claim }]));
      expect(shownText(root, "hero")).toBe("hero 2");
      expect(root.querySelector(".canccu-region--rail .canccu-is-claim")).not.toBeNull();
    });
  });
});

describe("the hero's features", () => {
  it("says tonight's highlight is on stage tonight", () => {
    const view = {
      label: "Grand final",
      target_at: "2026-03-14T21:15:00Z",
      highlight: true,
      chip: null,
    };
    expect(draw("countdown", view).querySelector(".canccu-widget__kicker")?.textContent).toBe(
      "Tonight on stage",
    );
  });

  it("adds up the day: the peak, the photos and the day's hours as bars", () => {
    const box = draw("today_numbers", {
      title: "Today in numbers",
      day_text: "Saturday",
      online_peak: { count: 231, time_text: "01:30" },
      photos: 38,
      points: [
        { time_text: "10:00", value: 40, level: 2 },
        { time_text: "11:00", value: 231, level: 10 },
      ],
    });
    expect(box.querySelector(".canccu-widget__kicker")?.textContent).toBe("Today in numbers");
    expect(box.querySelector(".canccu-widget__meta")?.textContent).toBe("Saturday, so far");
    expect(box.textContent).toContain("231most online, at 01:30");
    expect(box.textContent).toContain("38photos shared");
    const bars = [...box.querySelectorAll(".canccu-widget__point")].map((b) => b.className);
    expect(bars).toEqual([
      "canccu-widget__point canccu-widget__point--2",
      "canccu-widget__point canccu-widget__point--10",
    ]);
  });

  it("draws the activity graph with its label, its peak and a bar per hour", () => {
    const box = draw("activity_graph", {
      metric: "online",
      label: "Online · 24 h",
      peak: { count: 231, time_text: "01:30" },
      points: [{ time_text: "19:00", value: 120, level: 5 }],
    });
    expect(box.querySelector(".canccu-widget__kicker")?.textContent).toBe("Online · 24 h");
    expect(box.querySelector(".canccu-widget__peak")?.textContent).toBe("peak 231 · 01:30");
    expect(box.querySelectorAll(".canccu-widget__point--5")).toHaveLength(1);
  });

  it("draws a graph's value scale beside its bars and the labelled hours under them", () => {
    const box = draw("activity_graph", {
      label: "Online · 24 h",
      scale: [{ value: 300 }, { value: 200 }, { value: 100 }, { value: 0 }],
      points: [
        { time_text: "17:00", value: 120, level: 4 },
        { time_text: "18:00", value: 231, level: 8, tick_text: "18:00" },
      ],
    });
    const lines = [...box.querySelectorAll(".canccu-widget__scale .canccu-widget__gridline")];
    expect(lines.map((l) => l.textContent)).toEqual(["300", "200", "100", "0"]);
    // The bars' own labels say what a bar holds; the scale would only repeat it.
    expect(box.querySelector(".canccu-widget__scale")?.getAttribute("aria-hidden")).toBe("true");
    const bars = [...box.querySelectorAll(".canccu-widget__point")];
    expect(bars.map((b) => b.querySelector(".canccu-widget__hour")?.textContent)).toEqual([
      undefined,
      "18:00",
    ]);
  });
});
