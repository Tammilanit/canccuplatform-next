/**
 * Which events of the tenant streams make the hub (hub.ts) rebuild, recheck or end streams, and
 * the counts it keeps from them.
 */
import type { Event } from "@canccu/kit";
import { keepVoice, playingMoved, voiceOf } from "../compose/bot-live.js";
import { keepMessages, messagesOf } from "../compose/messages.js";
import { checkinsMoved, keepPresence, presenceOf } from "../compose/stats.js";
import type { Kv } from "../kv.js";
import type { CountSource } from "./store.js";

/** Events after which a zone may draw something else. */
const REBUILDS = [
  "screen.zone.saved",
  "screen.ticker.changed",
  "screen.content.",
  "screen.photo.",
  "screen.pin.changed",
  "agenda.item.",
  "agenda.items.",
  "agenda.kind.",
  "tenants.tenant.changed",
  "tenants.status.changed",
  "tenants.venue_info.changed",
  "theming.theme.published",
  // Main hands these on only once src/compose/overrides.ts, scenes.ts and src/moments-sound.ts
  // have kept them.
  "moments.override.",
  "moments.sound.",
  "moments.scene.",
  "moments.prefetch.",
  // Main hands these on once src/compose/food.ts has kept them.
  "pizza.order.",
  "pizza.item.",
];
/** The event's context changed: every stream checks its device again and may redraw. */
export const RECHECKS = new Set([
  "tenants.tenant.changed",
  "tenants.status.changed",
  "tenants.venue_ip_check.changed",
  "tenants.venue.changed",
]);
/** The device no longer serves this event, or its token stopped: its streams end. */
export const ENDS = new Set([
  "screen.device.revoked",
  "screen.device.released",
  "screen.device.moved",
]);

export function rebuilds(type: string): boolean {
  return REBUILDS.some((p) => (p.endsWith(".") ? type.startsWith(p) : type === p));
}

/** Keeps what the event counted; the counts that moved, none for an event that is no count. */
export async function keepCount(kv: Kv, tenant: string, event: Event): Promise<CountSource[]> {
  if (event.type === "bot.presence.counted") {
    const count = presenceOf(event.data);
    if (count === null) return [];
    await keepPresence(kv, tenant, count);
    // Players per game come with the presence feed: the bot's minute moved them too.
    await playingMoved(kv, tenant);
    return ["presence", "playing"];
  }
  if (event.type === "bot.voice.counted") {
    const count = voiceOf(event.data);
    if (count === null) return [];
    await keepVoice(kv, tenant, count);
    return ["voice"];
  }
  if (event.type === "bot.messages.counted") {
    const count = messagesOf(event.data);
    if (count === null) return [];
    await keepMessages(kv, tenant, count);
    return ["messages"];
  }
  if (event.type === "notify.checkin.recorded" && event.data.purpose === "arrival") {
    await checkinsMoved(kv, tenant);
    return ["checkins"];
  }
  return [];
}
