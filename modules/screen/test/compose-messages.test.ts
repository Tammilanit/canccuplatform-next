/**
 * Chat activity on the activity graph (contracts/screen.md, Widgets: `activity_graph`'s
 * `metric: messages`, Peaks: `messages_peak`): the hourly `bot.messages.counted`, kept 24 hours,
 * each hour's total as its bar. Counts only: no text, author or channel ever reaches Screen.
 */
import { withTenant } from "@canccu/kit";
import { describe, expect, it } from "vitest";
import { keepMessages, messagesOf, readMessages } from "../src/compose/messages.js";
import { presenceFacts } from "../src/compose/stats.js";
import { viewOf } from "../src/compose/widgets.js";
import type { ZoneFacts } from "../src/compose/widgets.js";
import { MemoryKv } from "../src/kv.js";

const NOW = Date.parse("2026-03-14T18:42:00Z");
const HOUR = 3600_000;
const hourAgo = (n: number) => Math.floor(NOW / HOUR) * HOUR - n * HOUR;

const facts = (over: Partial<ZoneFacts>): ZoneFacts => ({
  now: new Date(NOW),
  timeZone: "UTC",
  origin: "https://demo.example",
  eventName: "Demo Event",
  logoUrl: null,
  agenda: null,
  venue: null,
  ticker: { text: null, until: null, source: null },
  ...over,
});

describe("bot.messages.counted", () => {
  it("is read as an hour's total and refused otherwise", () => {
    const data = { counted_at: "2026-03-14T17:00:00Z", interval_seconds: 3600, messages: 126 };
    expect(messagesOf(data)).toEqual({ at: hourAgo(1), messages: 126 });
    expect(messagesOf({ ...data, interval_seconds: 60 })).toBeNull();
    expect(messagesOf({ ...data, messages: 1.5 })).toBeNull();
    expect(messagesOf({ ...data, counted_at: null })).toBeNull();
  });

  it("is kept for 24 hours, once however many containers keep it", async () => {
    const clock = { now: NOW };
    const kv = new MemoryKv(() => clock.now);
    for (const n of [1, 1, 30])
      await keepMessages(kv, "alpha", { at: hourAgo(n), messages: 10 * n });
    const kept = await withTenant("alpha", () => readMessages(kv, NOW));
    expect(kept).toEqual([{ at: hourAgo(1), messages: 10 }]);
  });
});

describe("the activity graph of chat", () => {
  const hours = [5, 4, 3, 2, 1].map((n, i) => ({ at: hourAgo(n), messages: [12, 40, 126, 90, 61][i] as number })); // prettier-ignore

  it("draws each hour's total, with the busiest hour as its peak", () => {
    const presence = presenceFacts([], "UTC", NOW, hours);
    expect(presence.messages_peak).toEqual({
      count: 126,
      at: new Date(hourAgo(3)).toISOString(),
      time_text: "15:00",
    });
    const view = viewOf("activity_graph", { metric: "messages" }, facts({ presence }));
    expect(view).toMatchObject({
      empty: false,
      metric: "messages",
      label: "Chat · 24 h",
      peak: { count: 126, time_text: "15:00" },
    });
    expect((view.points as { value: number }[]).map((p) => p.value)).toEqual([12, 40, 126, 90, 61]);
    expect(view.scale).toEqual([{ value: 150 }, { value: 100 }, { value: 50 }, { value: 0 }]);
  });

  it("waits under three hours of chat", () => {
    const presence = presenceFacts([], "UTC", NOW, hours.slice(3));
    expect(viewOf("activity_graph", { metric: "messages" }, facts({ presence })).empty).toBe(true);
  });
});
