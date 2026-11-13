/**
 * The `stats` widget's source (contracts/screen.md, Widgets, Trend arrows and Peaks): the bot's
 * presence counts, which Screen keeps for 24 hours in Valkey per event (counts only, no names, so
 * no presence data), and Notify's count of arrival check-ins, read again on
 * `notify.checkin.recorded` at most every 10 seconds.
 */
import { tenantKey, withTenant } from "@canccu/kit";
import type { Kv } from "../kv.js";
import type { Sources } from "./sources.js";

const DAY_MS = 24 * 3600_000;
const TREND_WINDOW_MS = 10 * 60_000;
const TREND_HOLD_MS = 60_000;
/** A count older than this many intervals no longer says who is online now. */
const LIVE_INTERVALS = 3;
export const CHECKINS_REREAD_MS = 10_000;

export interface PresenceCount {
  at: number;
  interval_seconds: number;
  members: number;
  online: number;
  in_voice: number;
}

const presenceKey = (): string => tenantKey("screen", "presence", "counts");
const checkinsKey = (): string => tenantKey("screen", "checkins", "arrival");
const staleKey = (): string => tenantKey("screen", "checkins", "arrival", "stale");

const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

/** A `bot.presence.counted` payload as a count, or null when it is not one. */
export function presenceOf(data: Record<string, unknown>): PresenceCount | null {
  const at = typeof data.counted_at === "string" ? Date.parse(data.counted_at) : NaN;
  const fields = [data.interval_seconds, data.members, data.online, data.in_voice].map(count);
  const [interval, members, online, inVoice] = fields;
  if (!Number.isFinite(at) || fields.some((f) => f === null)) return null;
  return {
    at,
    interval_seconds: interval as number,
    members: members as number,
    online: online as number,
    in_voice: inVoice as number,
  };
}

/**
 * Keep one count for 24 hours. Every container hears the event and writes the same member, so the
 * set holds it once.
 */
export async function keepPresence(kv: Kv, tenant: string, c: PresenceCount): Promise<void> {
  await withTenant(tenant, () => kv.addExpiring(presenceKey(), JSON.stringify(c), c.at + DAY_MS));
}

/** `notify.checkin.recorded` for `arrival`: the next build reads the count again. */
export async function checkinsMoved(kv: Kv, tenant: string): Promise<void> {
  await withTenant(tenant, () => kv.set(staleKey(), "1", DAY_MS));
}

type Trend = "up" | "down" | "flat";

const average = (counts: readonly PresenceCount[], pick: (c: PresenceCount) => number): number =>
  counts.reduce((sum, c) => sum + pick(c), 0) / counts.length;

/**
 * The last 10 minutes against the 10 before (widgets.md): turning only on a change of 3 % and of
 * at least 2. Read on the whole minute, so an arrow holds at least 60 s; absent under 20 minutes.
 */
export function trendOf(
  counts: readonly PresenceCount[],
  pick: (c: PresenceCount) => number,
  nowMs: number,
): Trend | undefined {
  const at = Math.floor(nowMs / TREND_HOLD_MS) * TREND_HOLD_MS;
  const seen = counts.filter((c) => c.at <= at);
  if (seen.length === 0 || (seen[0] as PresenceCount).at > at - 2 * TREND_WINDOW_MS) return;
  const recent = seen.filter((c) => c.at > at - TREND_WINDOW_MS);
  const before = seen.filter(
    (c) => c.at <= at - TREND_WINDOW_MS && c.at > at - 2 * TREND_WINDOW_MS,
  );
  if (recent.length === 0 || before.length === 0) return;
  const now = average(recent, pick);
  const was = average(before, pick);
  const change = now - was;
  if (Math.abs(change) < 2 || Math.abs(change) < was * 0.03) return "flat";
  return change > 0 ? "up" : "down";
}

/** The highest count of the last 24 hours and when it was first reached. */
export function peakOf(
  counts: readonly PresenceCount[],
  pick: (c: PresenceCount) => number,
  timeZone: string,
): { count: number; at: string; time_text: string } | undefined {
  let best: PresenceCount | undefined;
  for (const c of counts) if (best === undefined || pick(c) > pick(best)) best = c;
  if (best === undefined) return;
  const time_text = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(best.at);
  return { count: pick(best), at: new Date(best.at).toISOString(), time_text };
}

/** The view-model's fields from the kept counts and the check-ins; null with neither. */
export function statsView(
  counts: readonly PresenceCount[],
  checkedIn: number | null,
  timeZone: string,
  nowMs: number,
): Record<string, unknown> | null {
  const sorted = counts.filter((c) => c.at > nowMs - DAY_MS).sort((a, b) => a.at - b.at);
  const last = sorted.at(-1);
  const live =
    last !== undefined && nowMs - last.at <= LIVE_INTERVALS * last.interval_seconds * 1000;
  const view: Record<string, unknown> = {};
  if (live) {
    const fields = {
      members: (c: PresenceCount) => c.members,
      online: (c: PresenceCount) => c.online,
      in_voice: (c: PresenceCount) => c.in_voice,
    };
    for (const [name, pick] of Object.entries(fields)) {
      view[name] = pick(last);
      view[`${name}_trend`] = trendOf(sorted, pick, nowMs);
    }
    view.online_peak = peakOf(sorted, fields.online, timeZone);
    view.in_voice_peak = peakOf(sorted, fields.in_voice, timeZone);
  }
  if (checkedIn !== null) view.checked_in = checkedIn;
  // An absent field, never an undefined one: the fingerprint and the player read the same JSON.
  const fields = Object.entries(view).filter(([, v]) => v !== undefined);
  return fields.length === 0 ? null : Object.fromEntries(fields);
}

interface Kept {
  count: number;
  read_at: number;
}

/**
 * Notify's count of arrival check-ins: read at the first build and again after a check-in, at
 * most every 10 seconds; `retryAt` is when a waiting re-read is due, for the zone's next build.
 */
async function checkedIn(
  kv: Kv,
  sources: Sources,
  tenant: string,
  nowMs: number,
): Promise<{ count: number | null; retryAt: number | null }> {
  const raw = await kv.get(checkinsKey());
  const kept = raw === null ? null : (JSON.parse(raw) as Kept);
  const stale = (await kv.get(staleKey())) !== null;
  if (kept !== null && !stale) return { count: kept.count, retryAt: null };
  if (kept !== null && nowMs - kept.read_at < CHECKINS_REREAD_MS) {
    return { count: kept.count, retryAt: kept.read_at + CHECKINS_REREAD_MS };
  }
  // The mark goes before the read, never after: a check-in that lands while Notify counts sets it
  // again, so the next build reads once more instead of keeping a count that misses it.
  if (stale) await kv.del(staleKey());
  const read = await sources.checkinCount(tenant, "arrival");
  if (read === null) {
    // A failed read keeps what was read before, and tries again at the next build.
    if (stale) await kv.set(staleKey(), "1", DAY_MS);
    return { count: kept?.count ?? null, retryAt: null };
  }
  await kv.set(checkinsKey(), JSON.stringify({ count: read, read_at: nowMs }), DAY_MS);
  return { count: read, retryAt: null };
}

/** The `stats` view-model at `nowMs`, read in the event's tenant context. */
export async function readStats(
  kv: Kv,
  sources: Sources,
  tenant: string,
  timeZone: string,
  nowMs: number,
): Promise<{ view: Record<string, unknown> | null; changesAt: number | null }> {
  const members = await kv.live(presenceKey(), nowMs);
  const counts = members.flatMap((m) => {
    try {
      const c = JSON.parse(m) as Record<string, unknown>;
      const at = typeof c.at === "number" ? new Date(c.at).toISOString() : null;
      const kept = presenceOf({ ...c, counted_at: at });
      return kept === null ? [] : [kept];
    } catch {
      return [];
    }
  });
  const arrivals = await checkedIn(kv, sources, tenant, nowMs);
  return { view: statsView(counts, arrivals.count, timeZone, nowMs), changesAt: arrivals.retryAt };
}
