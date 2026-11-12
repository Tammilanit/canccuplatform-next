/** The Devices page's rules (E2, E3, E10) and the Studio's message keys (U11), on their own. */
import { describe, expect, it } from "vitest";
import { problemsOf, shownZone, uplinkDown } from "../src/studio/help.js";
import type { SeenDevice } from "../src/studio/help.js";
import { languageOf, translator } from "../src/studio/messages.js";

const at = (s: number) => new Date(Date.parse("2026-03-14T18:00:00Z") + s * 1000).toISOString();

function device(
  id: string,
  health: SeenDevice["health"],
  zone: string | null = "main",
): SeenDevice {
  return { id, name: id, zone_key: zone, mirror_of: null, ...(health ? { health } : {}) };
}
const offline = (id: string, seenS: number) =>
  device(id, { online: false, last_seen_at: at(seenS), flags: [] });
const online = (id: string, extra: Partial<NonNullable<SeenDevice["health"]>> = {}) =>
  device(id, { online: true, last_seen_at: at(0), flags: [], ...extra });

describe("uplinkDown", () => {
  it("is one notice when every screen dropped within one minute", () => {
    expect(uplinkDown([offline("a", 0), offline("b", 30), offline("c", 60)])).toBe(true);
  });

  it("is not when they dropped further apart, or one is still online", () => {
    expect(uplinkDown([offline("a", 0), offline("b", 61)])).toBe(false);
    expect(uplinkDown([offline("a", 0), offline("b", 10), online("c")])).toBe(false);
  });

  it("is not for a single screen, a never-seen one or none", () => {
    expect(uplinkDown([offline("a", 0)])).toBe(false);
    expect(uplinkDown([offline("a", 0), device("b", { online: false, last_seen_at: null })])).toBe(
      false,
    );
    expect(uplinkDown([])).toBe(false);
  });
});

describe("problemsOf", () => {
  it("gives a healthy screen no steps", () => {
    expect(problemsOf(online("a"), false)).toEqual([]);
  });

  it("gives an offline screen plain steps, starting at the uplink while it is down", () => {
    const alone = problemsOf(offline("a", 0), false)[0];
    expect(alone?.title).toBe("help.offline");
    expect(alone?.steps).toContain("help.offline.uplink_fine");
    expect(alone?.steps).toContain("help.offline.refused");
    const together = problemsOf(offline("a", 0), true)[0];
    expect(together?.steps[0]).toBe("help.offline.uplink_down");
    expect(together?.steps).not.toContain("help.offline.uplink_fine");
  });

  it("names a copied cookie, a wrong clock, a screen behind its zone and one not assigned", () => {
    const flagged = online("a", { flags: ["shared_token", "clock_drift"], state_lag: 3 });
    expect(problemsOf(flagged, false).map((p) => p.title)).toEqual([
      "help.shared_token",
      "help.clock_drift",
      "help.behind",
    ]);
    // One or two changes behind is a heartbeat not sent yet.
    expect(problemsOf(online("a", { state_lag: 2 }), false)).toEqual([]);
    expect(problemsOf(device("b", undefined, null), false).map((p) => p.title)).toEqual([
      "help.unassigned",
    ]);
  });
});

describe("shownZone", () => {
  it("is the device's zone, the zone it mirrors, or the mirrored device's", () => {
    const left = device("left", undefined, "hall");
    const right: SeenDevice = {
      ...device("right", undefined, null),
      mirror_of: { device_id: "left" },
    };
    const cafe: SeenDevice = {
      ...device("cafe", undefined, null),
      mirror_of: { zone_key: "cafe" },
    };
    const all = [left, right, cafe];
    expect(all.map((d) => shownZone(d, all))).toEqual(["hall", "hall", "cafe"]);
    expect(shownZone(device("x", undefined, null), all)).toBeNull();
  });
});

describe("messages", () => {
  it("fills values by name and leaves unknown ones as written", () => {
    const t = translator("en");
    expect(t("devices.summary", { total: 4, online: 3, offline: 1 })).toBe(
      "4 screens · 3 online · 1 offline",
    );
    expect(t("pair.done")).toBe("{device} is paired.");
  });

  it("falls back to English for a language without a catalogue yet", () => {
    expect(languageOf("fi")).toBe("en");
    expect(languageOf(42)).toBe("en");
    expect(translator("fi")("tab.live")).toBe("Live");
  });
});
