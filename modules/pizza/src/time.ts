/**
 * Times are stored in UTC and shown in the event's time zone (E8), through Intl, never a fixed
 * offset. The event day turns at 06:00 local (D4), so a 01:00 order belongs to the night it was in.
 */

const TURN_HOURS = 6;

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsIn(at: Date, timeZone: string): Parts {
  const out: Record<string, number> = {};
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  for (const p of fmt.formatToParts(at)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return {
    year: out.year ?? 0,
    month: out.month ?? 0,
    day: out.day ?? 0,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The zone's offset from UTC at `at`, in minutes. */
function offsetMinutes(at: Date, timeZone: string): number {
  const p = partsIn(at, timeZone);
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((local - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The event day `YYYY-MM-DD` of an instant: its local date, or the date before until 06:00 local.
 * Read on the local clock, not by going back 6 real hours, which a clock change would make 5 or 7.
 */
export function eventDay(at: Date, timeZone: string): string {
  const p = partsIn(at, timeZone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.hour < TURN_HOURS ? p.day - 1 : p.day));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** When `day` ends: 06:00 local on the next calendar day. */
export function dayTurn(day: string, timeZone: string): Date {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d + 1, TURN_HOURS);
  // The local 06:00 is the guess less the offset in force then; an offset change at 06:00 itself
  // never happens in practice (changes are at night), so one correction is enough.
  return new Date(guess - offsetMinutes(new Date(guess), timeZone) * 60_000);
}

/** `HH:MM` local. */
export function localTime(at: Date, timeZone: string): string {
  const p = partsIn(at, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** ISO 8601 with the event's offset, to the second: `2026-11-21T17:20:00+02:00`. */
export function withOffset(at: Date, timeZone: string): string {
  const p = partsIn(at, timeZone);
  const off = offsetMinutes(at, timeZone);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** `Thu 29.10.` for an event day. */
export function formatDayLabel(day: string): string {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
  return `${weekday} ${d}.${m}.`;
}

export const DAY = /^\d{4}-\d{2}-\d{2}$/;
