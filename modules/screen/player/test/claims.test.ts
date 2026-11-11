// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimShown } from "../src/claims.js";
import type { ClaimState } from "../src/claims.js";
import { Screen } from "../src/screen.js";
import type { Region } from "../src/state.js";
import { screenState } from "./fake.js";

const T0 = Date.parse("2026-03-14T18:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

function claim(over: Partial<ClaimState> = {}): ClaimState {
  return {
    override_id: "ov_10",
    hidden: false,
    role: "rail",
    rank: 80,
    template: "announcement",
    content: { title: "Dinner is served", body: "Café, until 19:00", level: "info" },
    steps: null,
    sound: null,
    on_end: "resume",
    starts_at: iso(T0),
    ends_at: null,
    expires_at: null,
    ...over,
  };
}

const widget = (text: string, dwell = 10) => ({
  widget: "ticker",
  template: null,
  dwell_seconds: dwell,
  view: { text, qr: null, stale: false, empty: false },
});

function region(id: string, over: Partial<Region> = {}): Region {
  return {
    id,
    role: id === "_full" ? "full" : id === "_overlay" ? "overlay" : id,
    area: { column: 1, row: 1, columns: 12, rows: 12 },
    layer: id === "_full" ? 10 : id === "_overlay" ? 11 : 0,
    rotation: "sequence",
    order: [],
    cycle_started_at: iso(T0),
    idle: id.startsWith("_") ? "blank" : "logo",
    idle_view: null,
    widgets: [],
    claim: null,
    ...over,
  };
}

/** A rail rotating A, B, C (10 s each, a cycle every 30 s from the epoch) and the synthetic two. */
function state(rail: Partial<Region> = {}, full: unknown = null, overlay: unknown = null) {
  return screenState({
    layout: { id: "pulse", aspect: "16:9", grid: { columns: 12, rows: 12 } },
    regions: [
      region("rail", {
        widgets: [widget("A"), widget("B"), widget("C")],
        order: [0, 1, 2],
        ...rail,
      }),
      region("_full", { claim: full }),
      region("_overlay", { claim: overlay }),
    ],
    display: { motion: "none", drift: false },
  });
}

let shift = 0;
const host = { serverNow: () => Date.now() + shift, reducedMotion: () => false };
const text = (screen: Screen, id: string) =>
  screen.root.querySelector(`.canccu-region--${id}`)?.textContent ?? "";
const typeIn = (screen: Screen, id: string) =>
  screen.root.querySelector(`.canccu-region--${id} > .canccu-widget`)?.className ?? "";

describe("what a claim shows", () => {
  it("plays its steps in order from its start, then keeps the last until its end", () => {
    const c = claim({
      template: "hot_game",
      steps: [
        { template: "sting", content: { text: "Hot right now" }, duration_ms: 2500 },
        { template: "hot_game", content: { players: 14 }, duration_ms: 30_000 },
      ],
      expires_at: iso(T0 + 120_000),
    });
    expect(claimShown(c, T0 + 1000)).toMatchObject({ type: "sting", key: "claim:ov_10:0" });
    expect(claimShown(c, T0 + 2500)).toMatchObject({ type: "hot_game", view: { players: 14 } });
    expect(claimShown(c, T0 + 90_000)).toMatchObject({ key: "claim:ov_10:1" });
    expect(claimShown(c, T0 + 120_000)).toBeNull();
  });

  it("ends at its expiry or its planned end, whichever is first", () => {
    const c = claim({ expires_at: iso(T0 + 60_000), ends_at: iso(T0 + 30_000) });
    expect(claimShown(c, T0 + 29_999)).not.toBeNull();
    expect(claimShown(c, T0 + 30_000)).toBeNull();
  });

  it("draws `pizza_placed` as `food_status`", () => {
    expect(claimShown(claim({ template: "pizza_placed" }), T0)?.type).toBe("food_status");
  });
});

describe("claims on the screen", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 + 5000 });
    shift = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws a claim in its region with its template instead of the rotation", () => {
    const screen = new Screen(host);
    screen.draw(state({ claim: claim() }));
    expect(typeIn(screen, "rail")).toContain("canccu-widget--announcement");
    expect(text(screen, "rail")).toContain("Dinner is served");
  });

  it("ends the claim on the device at its expiry, also with no word from the server", async () => {
    const screen = new Screen(host);
    screen.draw(state({ claim: claim({ expires_at: iso(T0 + 8000) }) }));
    screen.start();
    expect(text(screen, "rail")).toContain("Dinner");
    await vi.advanceTimersByTimeAsync(3000);
    // `resume`: the rotation where it would be now (A runs 0–10 s of the cycle).
    expect(text(screen, "rail")).toBe("A");
    screen.stop();
  });

  it("shows the next widget after a claim that ends with `next`", async () => {
    const screen = new Screen(host);
    screen.draw(state({ claim: claim({ on_end: "next", expires_at: iso(T0 + 8000) }) }));
    screen.start();
    await vi.advanceTimersByTimeAsync(3000);
    // Rotation is on A until 10 s; `next` skips the rest of it.
    expect(text(screen, "rail")).toBe("B");
    await vi.advanceTimersByTimeAsync(5000);
    expect(text(screen, "rail")).toBe("B");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(text(screen, "rail")).toBe("C");
    screen.stop();
  });

  it("goes on with `next` when a state drops the ended claim", () => {
    const screen = new Screen(host);
    screen.draw(state({ claim: claim({ on_end: "next" }) }));
    screen.draw(state());
    expect(text(screen, "rail")).toBe("B");
  });

  it("hides every region under a takeover, and brings a hidden claim back when it ends", async () => {
    const screen = new Screen(host);
    const takeover = claim({
      override_id: "ov_11",
      role: "full",
      rank: 100,
      content: {
        title: "Please leave the hall",
        body: "Follow the exit signs.",
        level: "emergency",
      },
      expires_at: iso(T0 + 8000),
    });
    screen.draw(state({ claim: claim({ hidden: true }) }, takeover));
    screen.start();
    expect(screen.root.dataset.takeover).toBe("");
    expect(text(screen, "_full")).toContain("Please leave the hall");
    expect(text(screen, "rail")).not.toContain("Dinner");
    await vi.advanceTimersByTimeAsync(3000);
    expect(screen.root.dataset.takeover).toBeUndefined();
    expect(text(screen, "_full")).toBe("");
    expect(text(screen, "rail")).toContain("Dinner");
    screen.stop();
  });

  it("draws an overlay band on top without hiding anything", () => {
    const screen = new Screen(host);
    const band = claim({
      override_id: "ov_20",
      role: "overlay",
      template: "match_called",
      content: { label: "Match 7", game_name: "Demo Game", teams: [] },
    });
    screen.draw(state({}, null, band));
    expect(screen.root.dataset.takeover).toBeUndefined();
    expect(typeIn(screen, "_overlay")).toContain("canccu-widget--match_called");
    expect(text(screen, "rail")).toBe("A");
  });

  it("uses the theme's template for a claim, named as its type", () => {
    const screen = new Screen(host);
    const tree = [
      { element: "p", attrs: {}, children: [{ text: "Themed: " }, { field: "title" }] },
    ];
    const s = state({ claim: claim() });
    s.theme = { ...s.theme, templates: [{ name: "announcement", widget: "announcement", tree }] };
    screen.draw(s);
    expect(text(screen, "rail")).toBe("Themed: Dinner is served");
  });
});
