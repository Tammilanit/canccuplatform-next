import { describe, expect, it } from "vitest";
import { buildRegions } from "../src/compose/build.js";
import type { BuildInput, RegionView } from "../src/compose/build.js";
import type { ZoneFacts } from "../src/compose/widgets.js";
import { shownAt } from "../player/src/rotation.js";

// The player runs the rotation itself between pushes (the diff leaves cycles and shuffles out), so
// it must reach the order the server's builder would give at the same moment.
const T0 = Date.parse("2026-01-01T12:00:07Z");

function build(nowMs: number, rotation: "sequence" | "shuffle"): RegionView {
  const facts: ZoneFacts = {
    now: new Date(nowMs),
    timeZone: "UTC",
    origin: "https://demo.example",
    eventName: "Demo Event",
    logoUrl: null,
    agenda: { current: [], next: [] },
    venue: null,
    ticker: { text: null, until: null, source: null },
  };
  const input: BuildInput = {
    zone: {
      key: "main",
      layoutId: null,
      regions: {
        rail: {
          rotation,
          widgets: [
            { widget: "clock", props: { dwell_seconds: 5 } },
            { widget: "qr", props: { url: "/a/", dwell_seconds: 7 } },
            { widget: "agenda_now" },
            { widget: "qr", props: { url: "/b/" } },
            { widget: "qr", props: { url: "/c/", dwell_seconds: 9 } },
          ],
        },
      },
    },
    windowLayoutId: null,
    themeLayouts: [],
    portrait: false,
    facts,
  };
  return buildRegions(input).regions.find((r) => r.id === "rail") as RegionView;
}

/** The widget the server's state at `at` says is on screen at `at`. */
function serverShown(at: number, rotation: "sequence" | "shuffle"): number | null {
  const r = build(at, rotation);
  let left = at - Date.parse(r.cycle_started_at);
  for (const i of r.order) {
    left -= (r.widgets[i]?.dwell_seconds ?? 0) * 1000;
    if (left < 0) return i;
  }
  return null;
}

describe("the player's rotation", () => {
  it("shows what the server's builder would, in sequence and shuffled, cycles after the state", () => {
    for (const rotation of ["sequence", "shuffle"] as const) {
      const state = build(T0, rotation);
      for (let s = 0; s < 400; s += 3) {
        const at = T0 + s * 1000;
        expect(shownAt(state, "main", at).index, `${rotation} at +${s}s`).toBe(
          serverShown(at, rotation),
        );
      }
    }
  });

  it("says when the shown widget changes, on whole seconds", () => {
    const state = build(T0, "sequence");
    const now = shownAt(state, "main", T0);
    expect(now.until % 1000).toBe(0);
    expect(now.until).toBeGreaterThan(T0);
    expect(shownAt(state, "main", now.until).index).not.toBe(now.index);
  });

  it("shows nothing when every widget is empty", () => {
    const state = { ...build(T0, "sequence"), order: [] };
    expect(shownAt(state, "main", T0)).toEqual({ index: null, until: Infinity });
  });
});
