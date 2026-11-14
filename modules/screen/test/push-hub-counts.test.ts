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
