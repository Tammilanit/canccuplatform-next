/**
 * Chat activity for `activity_graph`'s `metric: messages` (contracts/screen.md, Widgets and Peaks):
 * the bot's hourly `bot.messages.counted`, Screen's one source for it, kept 24 hours per event in
 * Valkey. A count only: the bot never sends text, author or channel (contracts/bot.md, Counts).
 */
import { tenantKey, withTenant } from "@canccu/kit";
import type { Kv } from "../kv.js";

const DAY_MS = 24 * 3600_000;
const HOUR_S = 3600;

/** One hour's messages, `at` its start. */
export interface MessagesCount {
  at: number;
  messages: number;
}

const messagesKey = (): string => tenantKey("screen", "messages", "counts");

/** A `bot.messages.counted` payload as an hour's count, or null when it is not one. */
export function messagesOf(data: Record<string, unknown>): MessagesCount | null {
  const at = typeof data.counted_at === "string" ? Date.parse(data.counted_at) : NaN;
  const { messages } = data;
  const whole = typeof messages === "number" && Number.isInteger(messages) && messages >= 0;
  if (!Number.isFinite(at) || data.interval_seconds !== HOUR_S || !whole) return null;
  return { at, messages };
}

/** Keep one hour for 24 hours; every container writes the same member, so the set holds it once. */
export async function keepMessages(kv: Kv, tenant: string, c: MessagesCount): Promise<void> {
  await withTenant(tenant, () => kv.addExpiring(messagesKey(), JSON.stringify(c), c.at + DAY_MS));
}

/** The hours kept for the last 24 hours, read in the event's tenant context. */
export async function readMessages(kv: Kv, nowMs: number): Promise<MessagesCount[]> {
  const members = await kv.live(messagesKey(), nowMs);
  return members.flatMap((m) => {
    try {
      const c = JSON.parse(m) as Record<string, unknown>;
      const at = typeof c.at === "number" ? new Date(c.at).toISOString() : null;
      const kept = messagesOf({ ...c, counted_at: at, interval_seconds: HOUR_S });
      return kept === null ? [] : [kept];
    } catch {
      return [];
    }
  });
}
