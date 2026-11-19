// @vitest-environment happy-dom
/**
 * A storyboard's steps on the screens (#625; docs/briefs/step-4-polish, sheets 07–09): the
 * outgoing step leaves before the next comes in, so two steps' text is never drawn at once (S2);
 * Midnight's sting is up on every zone in the second it lands, the portrait entrance too (S2);
 * a story's countdown under an hour reads as minutes and seconds (sheet 08, 7); the urgent
 * announcement says so (R6, A3); a countdown step's own line under its counter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimState } from "../src/claims.js";
import { Screen } from "../src/screen.js";
import type { Region, ScreenState } from "../src/state.js";
import { drawWidget, fillCountdowns } from "../src/widget.js";
import { screenState } from "./fake.js";

const MIDNIGHT = Date.parse("2026-03-15T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

function claim(steps: ClaimState["steps"], startsAt: number, role = "full"): ClaimState {
  return {
    override_id: "ov_midnight",
    hidden: false,
    role,
    rank: 65,
    template: steps?.[0]?.template ?? "title_card",
    content: steps?.[0]?.content ?? {},
    steps,
    sound: null,
    on_end: "resume",
    starts_at: iso(startsAt),
    ends_at: null,
    expires_at: iso(startsAt + 60_000),
  };
}

/** Midnight as Moments sends it: 10 s of countdown from 23:59:50, the sting on the dot, the card. */
const midnight = (role = "full") =>
  claim(
    [
      {
        template: "countdown",
        content: { label: "Midnight", target_at: iso(MIDNIGHT), ends_text: "" },
        duration_ms: 10_000,
        transition: "rise",
      },
      {
        template: "sting",
        content: { text: "Midnight!", image_url: null },
        duration_ms: 4000,
        transition: "flash",
      },
      {
        template: "title_card",
        content: { title: "Night 2 at Demo Event", subtitle: "Keep it going", image_url: null },
        duration_ms: 15_000,
        transition: "rise",
      },
    ],
    MIDNIGHT - 10_000,
    role,
  );

function region(id: string, role: string, c: ClaimState | null): Region {
  return {
    id,
    role,
    area: { column: 1, row: 1, columns: 12, rows: 1 },
    layer: 0,
    rotation: "sequence",
    order: [0],
    cycle_started_at: iso(MIDNIGHT - 60_000),
    idle: "blank",
    idle_view: null,
    widgets: [],
    claim: c,
  };
}

const LANDSCAPE = { id: "pulse", aspect: "16:9", grid: { columns: 12, rows: 12 } };
const PORTRAIT = { id: "pulse_portrait", aspect: "9:16", grid: { columns: 6, rows: 16 } };

function state(layout: typeof LANDSCAPE, regions: Region[]): ScreenState {
  return screenState({ layout, regions, display: { motion: "moderate", drift: false } });
}

/** The texts a region draws now, each widget's, the fading ones too. */
const drawn = (screen: Screen, id: string) =>
  [...(screen.root.querySelector(`.canccu-region--${id}`)?.children ?? [])].map(
    (el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );

describe("a storyboard's steps on the screen", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: MIDNIGHT - 5000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes the outgoing step away before the next one comes in: never two steps' text at once", async () => {
    const screen = new Screen({ serverNow: () => Date.now(), reducedMotion: () => false });
    screen.draw(state(LANDSCAPE, [region("hero", "hero", midnight("hero"))]));
    screen.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(drawn(screen, "hero")).toHaveLength(1);
    // Each tick across the countdown → sting → card changes: one step drawn at every moment.
    for (let ms = 0; ms < 12_000; ms += 100) {
      await vi.advanceTimersByTimeAsync(100);
      expect(drawn(screen, "hero").length, `at +${String(ms + 100)} ms`).toBeLessThanOrEqual(1);
    }
    expect(drawn(screen, "hero")).toEqual(["Night 2 at Demo Event Keep it going"]);
    screen.stop();
  });

  it("shows Midnight's sting within 1 s of 00:00:00 on every zone, the portrait entrance too", async () => {
    // Two zones, each its own screen; the entrance's clock runs 700 ms behind the server's.
    const main = new Screen({ serverNow: () => Date.now(), reducedMotion: () => false });
    const entrance = new Screen({ serverNow: () => Date.now(), reducedMotion: () => false });
    main.draw(state(LANDSCAPE, [region("hero", "hero", null), region("_full", "full", midnight())]));
    entrance.draw(
      state(PORTRAIT, [region("hero", "hero", null), region("_full", "full", midnight())]),
    );
    main.start();
    entrance.start();
    await vi.advanceTimersByTimeAsync(4000);
    for (const s of [main, entrance]) {
      expect(s.root.querySelector(".canccu-region--_full .canccu-widget--countdown")).not.toBeNull();
      expect(s.root.dataset.takeover).toBe("");
    }
    await vi.advanceTimersByTimeAsync(1000);
    for (const [name, s] of [
      ["main", main],
      ["entrance", entrance],
    ] as const) {
      const sting = s.root.querySelector(".canccu-region--_full > .canccu-widget--sting");
      expect(sting, name).not.toBeNull();
      expect(sting?.classList.contains("canccu-slot--in"), name).toBe(false);
      expect(s.root.querySelector(".canccu-region--_full .canccu-widget--countdown"), name).toBeNull();
    }
    main.stop();
    entrance.stop();
  });
});

describe("a story's countdown and the urgent card", () => {
  it("counts a story's last hour in minutes and seconds, and keeps the hours elsewhere", () => {
    const view = { label: "Demo Cup, final", target_at: iso(MIDNIGHT), ends_text: "Stage" };
    const step = drawWidget("countdown", null, view, null);
    step.classList.add("canccu-is-claim");
    const pulse = drawWidget("countdown", null, view, null);
    const root = document.createElement("main");
    root.append(step, pulse);
    fillCountdowns(root, MIDNIGHT - 294_000);
    const big = (el: Element) => el.querySelector(".canccu-widget__count .canccu-widget__big");
    expect(big(step)?.textContent).toBe("04:54");
    expect(big(pulse)?.textContent).toBe("00:04:54");
    fillCountdowns(root, MIDNIGHT - 3_725_000);
    expect(big(step)?.textContent).toBe("01:02:05");
  });

  it("draws a countdown step's own line under its counter", () => {
    const el = drawWidget(
      "countdown",
      null,
      { label: "Demo Cup, final", target_at: iso(MIDNIGHT), ends_text: "Stage · in 5 minutes" },
      null,
    );
    expect(el.querySelector(".canccu-widget__ends")?.textContent).toBe("Stage · in 5 minutes");
    const none = drawWidget("countdown", null, { label: "Next", target_at: iso(MIDNIGHT) }, null);
    expect(none.querySelector(".canccu-widget__ends")).toBeNull();
  });

  it("says URGENT on an urgent announcement and Announcement on another, from the crew neither", () => {
    const card = (level: string, more: Record<string, unknown> = {}) =>
      drawWidget("announcement", null, { title: "Semis in 15 min", body: "", level, ...more }, null);
    const urgent = card("urgent");
    expect(urgent.querySelector(".canccu-widget__level--urgent .canccu-widget__urgent")?.textContent).toBe(
      "Urgent",
    );
    expect(card("info").querySelector(".canccu-widget__kicker")?.textContent).toContain(
      "Announcement",
    );
    expect(card("urgent", { from_crew: true }).querySelector(".canccu-widget__urgent")).toBeNull();
  });
});
