/** The Devices page's rules (E2, E3, E10) and the Studio's message keys (U11), on their own. */
import { describe, expect, it } from "vitest";
import { problemsOf, shownZone, uplinkDown } from "../src/studio/help.js";
import type { SeenDevice } from "../src/studio/help.js";
import { counted, languageOf, nameOf, readable, translator } from "../src/studio/messages.js";
import { nowShowing } from "../src/studio/now-line.js";
import { shownAt as playerShownAt } from "../player/src/rotation.js";
import type { RegionView, WidgetView } from "../src/compose/build.js";
import type { ZoneRecord } from "../src/push/store.js";

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
    expect(problemsOf(online("a"), [online("a")])).toEqual([]);
  });

  it("gives an offline screen plain steps, starting at the uplink while it is down", () => {
    const a = offline("a", 0);
    const beside = problemsOf(a, [a, online("b")])[0];
    expect(beside?.title).toBe("help.offline");
    expect(beside?.steps).toContain("help.offline.uplink_fine");
    expect(beside?.steps).toContain("help.offline.refused");
    const together = problemsOf(a, [a, offline("b", 30)])[0];
    expect(together?.steps[0]).toBe("help.offline.uplink_down");
    expect(together?.steps).not.toContain("help.offline.uplink_fine");
  });

  it("says the uplink is fine only while another screen is online", () => {
    const a = offline("a", 0);
    // One screen alone proves nothing about the uplink.
    const alone = problemsOf(a, [a])[0];
    expect(alone?.title).toBe("help.offline");
    expect(alone?.steps).not.toContain("help.offline.uplink_fine");
    expect(alone?.steps).not.toContain("help.offline.uplink_down");
    // All down, but more than a minute apart: not one cause, and not a working uplink either.
    const spread = problemsOf(a, [a, offline("b", 61), offline("c", 200)])[0];
    expect(spread?.steps).not.toContain("help.offline.uplink_fine");
    expect(spread?.steps).not.toContain("help.offline.uplink_down");
    // A screen never seen is no proof the uplink works.
    const unseen = device("b", { online: false, last_seen_at: null });
    expect(problemsOf(a, [a, unseen])[0]?.steps).not.toContain("help.offline.uplink_fine");
  });

  it("names a copied cookie, a wrong clock, a screen behind its zone and one not assigned", () => {
    const flagged = online("a", { flags: ["shared_token", "clock_drift"], state_lag: 3 });
    expect(problemsOf(flagged, [flagged]).map((p) => p.title)).toEqual([
      "help.shared_token",
      "help.clock_drift",
      "help.behind",
    ]);
    // One or two changes behind is a heartbeat not sent yet.
    const lagging = online("a", { state_lag: 2 });
    expect(problemsOf(lagging, [lagging])).toEqual([]);
    const unassigned = device("b", undefined, null);
    expect(problemsOf(unassigned, [unassigned]).map((p) => p.title)).toEqual(["help.unassigned"]);
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

  it("names widgets and regions in words, and a key it does not know readably, never raw", () => {
    const t = translator("en");
    expect(nameOf(t, "widget", "agenda_now")).toBe("Now and next");
    expect(nameOf(t, "region", "venue_rail")).toBe("Venue card");
    expect(nameOf(t, "region", "side_panel")).toBe("Side panel");
    expect(readable("hot-game_2")).toBe("Hot game 2");
  });

  it("says one screen, not one screens", () => {
    const t = translator("en");
    expect(counted(t, "devices.summary", 1, { total: 1, online: 1, offline: 0 })).toBe(
      "1 screen · 1 online · 0 offline",
    );
    expect(counted(t, "zone.save_on", 2)).toBe("Go live on 2 screens");
    expect(counted(t, "zone.save_on", 1)).toBe("Go live on 1 screen");
  });

  it("falls back to English for a language without a catalogue yet", () => {
    expect(languageOf("fi")).toBe("en");
    expect(languageOf(42)).toBe("en");
    expect(translator("fi")("tab.live")).toBe("Live");
  });
});

describe("what a device card says a screen shows now", () => {
  const t = translator("en");
  const start = Date.parse("2026-03-14T18:00:00Z");
  const widget = (name: string, view: Record<string, unknown> = {}) =>
    ({ widget: name, template: null, embed: null, dwell_seconds: 10, stale_after_seconds: null, view }) as unknown as WidgetView; // prettier-ignore
  const hero = (over: Partial<RegionView>): RegionView =>
    ({ id: "hero", role: "hero", order: [], cycle_started_at: new Date(start).toISOString(), idle: "next", idle_view: null, widgets: [], claim: null, ...over }) as unknown as RegionView; // prettier-ignore
  const record = (regions: RegionView[], portrait: RegionView[] = []) =>
    ({ zone: { key: "main" }, views: { landscape: { layout: null, regions }, portrait: { layout: null, regions: portrait } } }) as unknown as ZoneRecord; // prettier-ignore

  it("names the hero's idle countdown by the item it counts down to", () => {
    const idle = hero({ idle_view: { widget: "countdown", view: { label: "Dinner" } } as unknown as RegionView["idle_view"] }); // prettier-ignore
    expect(nowShowing(t, record([idle]), false, start)).toBe("Dinner countdown");
    // The portrait layout is a view of its own: a portrait screen reads that one.
    expect(nowShowing(t, record([idle], [hero({ idle: "logo" })]), true, start)).toBe(
      "the event's logo",
    );
  });

  it("follows the hero's rotation from the epoch-anchored cycle, as every screen of the zone does", () => {
    const turning = hero({ order: [0, 1], widgets: [widget("photo"), widget("countdown", { label: "Finals" })] }); // prettier-ignore
    expect(nowShowing(t, record([turning]), false, start + 3_000)).toBe("Photo");
    expect(nowShowing(t, record([turning]), false, start + 13_000)).toBe("Finals countdown");
    expect(nowShowing(t, record([turning]), false, start + 23_000)).toBe("Photo");
  });

  it("follows a shuffled hero into later cycles, as the player reshuffles it", () => {
    const names = ["photo", "clock", "qr", "agenda_now"];
    const shuffled = hero({ rotation: "shuffle", order: [2, 0, 3, 1], widgets: names.map((n) => widget(n)) }); // prettier-ignore
    const shown: number[] = [];
    // Three cycles of 40 s, every 10 s, each mid-dwell.
    for (let s = 0; s < 120; s += 10) {
      const at = start + s * 1000 + 5_000;
      const index = playerShownAt(shuffled, "main", at).index as number;
      shown.push(index);
      expect(nowShowing(t, record([shuffled]), false, at), `+${s}s`).toBe(
        nameOf(t, "widget", names[index] as string),
      );
    }
    // The stored order alone, repeated, would have named other widgets.
    const repeated = shown.map((_, i) => shuffled.order[i % 4]);
    expect(shown).not.toEqual(repeated);
  });

  it("says a takeover or the hero's claim before its widgets, and nothing without a state", () => {
    const claim = (title: unknown) => ({ template: "announcement", content: { title } }) as unknown as RegionView["claim"]; // prettier-ignore
    const claimed = hero({ widgets: [widget("photo")], order: [0], claim: claim("Dinner is served") }); // prettier-ignore
    expect(nowShowing(t, record([claimed]), false, start)).toBe("Dinner is served");
    const full = hero({ id: "_full", role: "full", claim: claim("Please leave the hall") });
    expect(nowShowing(t, record([claimed, full]), false, start)).toBe("Please leave the hall");
    expect(nowShowing(t, null, false, start)).toBeNull();
  });
});
