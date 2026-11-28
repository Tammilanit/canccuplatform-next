/**
 * The `stats` widget's events reach the hub (contracts/screen.md, `stats`): every container keeps
 * the bot's counts and marks Notify's count to be read again, also one with no stream of the event.
 */
import { tenantKey, withTenant } from "@canccu/kit";
import type { Event } from "@canccu/kit";
import { describe, expect, it } from "vitest";
import { MemoryKv } from "../src/kv.js";
import { PushHub } from "../src/push/hub.js";
import type { HubDeps } from "../src/push/hub.js";
import { MemoryFanout } from "../src/push/store.js";

const T0 = Date.parse("2026-03-14T18:00:00Z");

const event = (source: string, type: string, data: Record<string, unknown>): Event =>
  ({ id: "e1", source, type, tenant: "alpha", data, version: 1 }) as unknown as Event;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the hub and the counts", () => {
  const kv = new MemoryKv(() => T0);
  const hub = new PushHub({
    kv,
    fanout: new MemoryFanout(),
    tenantChanged: () => undefined,
    now: () => T0,
  } as unknown as HubDeps);

  it("keeps bot.presence.counted for the event, with no stream of it here", async () => {
    const counted = {
      counted_at: new Date(T0).toISOString(),
      interval_seconds: 60,
      members: 400,
      online: 212,
      idle: 0,
      dnd: 0,
      in_voice: 36,
    };
    hub.handleEvent(event("bot", "bot.presence.counted", counted));
    hub.handleEvent(event("bot", "bot.presence.counted", { ...counted, online: "many" }));
    await settle();
    const kept = await withTenant("alpha", () =>
      kv.live(tenantKey("screen", "presence", "counts"), T0),
    );
    expect(kept.map((m) => JSON.parse(m) as unknown)).toEqual([
      { at: T0, interval_seconds: 60, members: 400, online: 212, in_voice: 36 },
    ]);
  });

  it("keeps the public voice rooms of bot.voice.counted and the hours of bot.messages.counted", async () => {
    const at = new Date(T0).toISOString();
    const rooms = [{ channel_id: "c1", name: "Lobby", member_count: 14 }];
    hub.handleEvent(
      event("bot", "bot.voice.counted", { counted_at: at, interval_seconds: 60, rooms }),
    );
    hub.handleEvent(
      event("bot", "bot.messages.counted", { counted_at: at, interval_seconds: 3600, messages: 9 }),
    );
    await settle();
    const voice = await withTenant("alpha", () => kv.get(tenantKey("screen", "voice", "counted")));
    expect(JSON.parse(voice ?? "null")).toEqual({
      at: T0,
      interval_seconds: 60,
      rooms: [{ name: "Lobby", member_count: 14 }],
    });
    const hours = await withTenant("alpha", () =>
      kv.live(tenantKey("screen", "messages", "counts"), T0),
    );
    expect(hours.map((m) => JSON.parse(m) as unknown)).toEqual([{ at: T0, messages: 9 }]);
  });

  it("marks players per game to be read again on bot.presence.counted", async () => {
    const stale = () => withTenant("alpha", () => kv.get(tenantKey("screen", "playing", "stale")));
    expect(await stale()).toBe("1");
  });

  it("marks the arrival count to be read again on an arrival check-in only", async () => {
    const stale = () =>
      withTenant("alpha", () => kv.get(tenantKey("screen", "checkins", "arrival", "stale")));
    hub.handleEvent(event("notify", "notify.checkin.recorded", { purpose: "tournament:s_1" }));
    await settle();
    expect(await stale()).toBeNull();
    hub.handleEvent(event("notify", "notify.checkin.recorded", { purpose: "arrival" }));
    await settle();
    expect(await stale()).toBe("1");
  });
});
