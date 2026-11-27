// @vitest-environment happy-dom
// A living screen, part A (issue #787, docs/plans/issue-787.md D5–D7): a turn is never a hard cut,
// at any level; the rotation draws only what no claim holds and comes back where its clock has it;
// what the hero shows, no other box repeats.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimState } from "../src/claims.js";
import { FADE_MS } from "../src/display.js";
import { Screen } from "../src/screen.js";
import type { Region, ScreenState, WidgetState } from "../src/state.js";
import { screenState } from "./fake.js";

const T0 = Date.parse("2026-03-14T18:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

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
    rotation: "sequence",
    order: [0, 1],
    cycle_started_at: iso(T0),
    idle: "logo",
    idle_view: null,
    widgets: [ticker("a"), ticker("b")],
    claim: null,
    ...over,
  };
}

const state = (regions: Region[], motion = "none"): ScreenState =>
  screenState({
    layout: { id: "pulse", aspect: "16:9", grid: { columns: 12, rows: 12 } },
    regions,
    display: { motion: "moderate", motion_level: motion, drift: false },
  });

let reduced = false;
const host = { serverNow: () => Date.now(), reducedMotion: () => reduced };
const box = (root: ParentNode, id: string) => root.querySelector(`.canccu-region--${id}`);
const slots = (root: ParentNode, id: string) =>
  [...(box(root, id)?.children ?? [])].filter((el) => el.classList.contains("canccu-widget"));
const lines = (root: ParentNode, id: string) =>
  slots(root, id).map((el) => el.querySelector(".canccu-widget__line")?.textContent ?? "");
/** The widget a box turned to last: while a turn fades, the outgoing one is still there. */
const active = (root: ParentNode, id: string) =>
  [...(box(root, id)?.querySelectorAll(".canccu-is-active .canccu-widget__line") ?? [])].at(-1)
    ?.textContent;

describe("a turn is never a hard cut (D5)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 + 1000 });
    reduced = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("crossfades at every level, `none` included, for longer than nothing", () => {
    for (const level of ["calm", "lively", "party", "none"] as const) {
      expect(FADE_MS[level === "lively" || level === "party" ? "moderate" : level]).toBeGreaterThan(
        0,
      );
    }
    expect(FADE_MS.none).toBe(400);
  });

  for (const [why, level, isReduced] of [
    ["at the level `none`", "none", false],
    ["under reduced motion", "party", true],
  ] as const) {
    it(`keeps the outgoing widget on screen while the next fades in ${why}`, async () => {
      reduced = isReduced;
      const screen = new Screen(host);
      const root = screen.draw(state([region("hero")], level));
      screen.start();
      expect(lines(root, "hero")).toEqual(["a"]);
      await vi.advanceTimersByTimeAsync(9000);
      // Both are there: the old one leaving, the new one coming in; never a swap at once.
      expect(lines(root, "hero")).toEqual(["a", "b"]);
      expect(slots(root, "hero")[0]?.classList.contains("canccu-slot--out")).toBe(true);
      await vi.advanceTimersByTimeAsync(FADE_MS.none);
      expect(lines(root, "hero")).toEqual(["b"]);
      screen.stop();
    });
  }
});

function claim(over: Partial<ClaimState> = {}): ClaimState {
  return {
    override_id: "ov_10",
    hidden: false,
    role: "hero",
    rank: 80,
    template: "announcement",
    content: { title: "Dinner is served", body: "Café, until 19:00", level: "info" },
    steps: null,
    sound: null,
    on_end: "resume",
    starts_at: iso(T0),
    ends_at: iso(T0 + 25_000),
    expires_at: null,
    ...over,
  };
}

describe("the rotation fills only what no moment holds (D6)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 + 1000 });
    reduced = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves a held region to its moment, rotates the free ones, and resumes on the clock", () => {
    const screen = new Screen(host);
    const hero = region("hero", { claim: claim() });
    const rail = region("rail", { widgets: [ticker("r1"), ticker("r2")] });
    const root = screen.draw(state([hero, rail]));
    expect(box(root, "hero")?.textContent).toContain("Dinner is served");
    expect(active(root, "hero")).toBeUndefined();
    expect(active(root, "rail")).toBe("r1");
    vi.setSystemTime(T0 + 12_000);
    screen.tick();
    expect(box(root, "hero")?.textContent).toContain("Dinner is served");
    expect(active(root, "rail")).toBe("r2");
    // The moment is over at 25 s; the clock has the rotation at its third turn (`a` again).
    vi.setSystemTime(T0 + 26_000);
    screen.tick();
    expect(active(root, "hero")).toBe("a");
  });
});

describe("one place at a time for the rotation's own items (D7)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 + 1000 });
    reduced = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const food = widget("food_status", { title: "Food", orders: [], big_text: "18:30" });
  const wifi = widget("venue_info", { wifi: [{ ssid: "Demo", password: null, note: null }] });

  it("leaves the food box out of the venue rail while the hero shows the food item", () => {
    const hero = region("hero", { order: [0, 1], widgets: [food, ticker("h")] });
    const venue = region("venue_rail", {
      order: [0, 1],
      widgets: [
        { ...food, dwell_seconds: 5 },
        { ...wifi, dwell_seconds: 5 },
      ],
    });
    const screen = new Screen(host);
    const root = screen.draw(state([hero, venue]));
    const shows = (id: string, type: string) =>
      [...(box(root, id)?.querySelectorAll(":scope > .canccu-widget.canccu-is-active") ?? [])]
        .at(-1)
        ?.classList.contains(`canccu-widget--${type}`) === true;
    const tick = (ms: number) => {
      vi.setSystemTime(T0 + ms);
      screen.tick();
    };
    // 0–5 s: the venue rail's turn is food, but the hero shows it, so the rail shows its next.
    expect(shows("hero", "food_status")).toBe(true);
    expect(shows("venue_rail", "food_status")).toBe(false);
    expect(shows("venue_rail", "venue_info")).toBe(true);
    // 10–15 s: the hero has turned on, so the food box is the venue rail's again.
    tick(11_500);
    tick(14_500);
    expect(active(root, "hero")).toBe("h");
    expect(shows("venue_rail", "food_status")).toBe(true);
    // 20–25 s: the hero shows food again, and the venue rail leaves it out again.
    tick(21_500);
    tick(24_500);
    expect(shows("hero", "food_status")).toBe(true);
    expect(shows("venue_rail", "food_status")).toBe(false);
  });

  // #787 D14: one QR on screen at a time; the hub QR waits while the hero shows the order's.
  it("skips the hub QR's turn while the hero shows a QR, and gives it back after", () => {
    const join = { url: "https://demo.example/pizza/orders/po_1", label: "Join the order", image_url: "data:image/png;base64,AA==" }; // prettier-ignore
    const order = widget("food_status", { title: "Food", orders: [], big_text: "18:30", join });
    const hub = widget("qr", { url: "https://demo.example/notify/", label: "The event hub", image_url: "data:image/png;base64,AA==" }); // prettier-ignore
    const hero = region("hero", { order: [0, 1], widgets: [order, ticker("h")] });
    const venue = region("venue_rail", {
      order: [0, 1],
      widgets: [
        { ...hub, dwell_seconds: 5 },
        { ...wifi, dwell_seconds: 5 },
      ],
    });
    const screen = new Screen(host);
    const root = screen.draw(state([hero, venue]));
    const shows = (type: string) =>
      [
        ...(box(root, "venue_rail")?.querySelectorAll(":scope > .canccu-widget.canccu-is-active") ??
          []),
      ]
        .at(-1)
        ?.classList.contains(`canccu-widget--${type}`) === true;
    // 0–5 s: the venue rail's turn is the hub QR, but the hero shows the order's QR.
    expect(shows("qr")).toBe(false);
    expect(shows("venue_info")).toBe(true);
    // 10–15 s: the hero has turned to a line without a QR: the hub QR has its turn.
    vi.setSystemTime(T0 + 11_500);
    screen.tick();
    // One notable change per 3 s (the choreographer): the rail's comes after the hero's.
    vi.setSystemTime(T0 + 14_500);
    screen.tick();
    expect(shows("qr")).toBe(true);
  });
});
