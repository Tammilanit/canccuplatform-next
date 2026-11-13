/**
 * Live's quick actions (#444; mockup 13, the crew remote): the three things done most on the floor,
 * one tap each, for whoever holds the right for each.
 */
import { describe, expect, it } from "vitest";
import type { AgendaItem } from "../src/compose/widgets.js";
import { quickActions, runningNow } from "../src/studio/live-quick.js";
import { translator } from "../src/studio/messages.js";
import type { ViewContext } from "../src/studio/views.js";

const NOW = Date.parse("2026-11-13T18:42:00Z");
const ALL = [
  "screen.devices.read",
  "agenda.items.write",
  "screen.ticker.write",
  "screen.push.write",
];
const ctx = (rights: string[] = ALL): ViewContext => ({
  t: translator("en"),
  rights: new Set(rights),
  nowMs: NOW,
  timeZone: "UTC",
  startUrl: null,
});
const item = (
  id: string,
  starts: string,
  ends: string | null,
  status = "scheduled",
): AgendaItem => ({
  id,
  title: id,
  kind: "activity",
  starts_at: `2026-11-13T${starts}:00Z`,
  ends_at: ends === null ? null : `2026-11-13T${ends}:00Z`,
  delay_minutes: 0,
  location: null,
  visibility: "public",
  status,
});

describe("Live's quick actions", () => {
  it("offers the three, in mockup 13's order, as one-tap links", () => {
    const html = String(quickActions(ctx(), item("dinner", "18:00", "19:15")));
    expect(html).toContain("Quick actions");
    const links = [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(links).toEqual([
      ["/agenda/items/dinner/delay", "Delay what’s on now…"],
      ["/admin/screen/ticker", "Set the ticker…"],
      ["/admin/screen/content#push", "Push content now…"],
    ]);
  });

  it("sends Delay to the run of show, saying so, while nothing runs", () => {
    const html = String(quickActions(ctx(), null));
    expect(html).toContain('href="/agenda/"');
    expect(html).toContain("Nothing runs now");
  });

  it("leaves out what the person may not do", () => {
    const html = String(quickActions(ctx(["screen.devices.read", "screen.ticker.write"]), null));
    expect(html).not.toContain("Delay");
    expect(html).not.toContain("Push");
    expect(html).toContain("Set the ticker");
    expect(String(quickActions(ctx(["screen.devices.read"]), null))).toBe("");
  });
});

describe("what runs now", () => {
  it("is the item that started last among those running, never a cancelled or finished one", () => {
    const items = [
      item("doors", "17:00", "23:00"),
      item("dinner", "18:00", "19:15"),
      item("quiz", "18:30", "19:30", "cancelled"),
      item("talk", "16:00", "17:00"),
      item("later", "19:00", "20:00"),
    ];
    expect(runningNow(items, NOW)?.id).toBe("dinner");
    expect(runningNow([item("talk", "16:00", "17:00")], NOW)).toBeNull();
    expect(runningNow(null, NOW)).toBeNull();
  });

  it("counts an item with no end as running from its start", () => {
    expect(runningNow([item("open", "18:40", null)], NOW)?.id).toBe("open");
  });
});
