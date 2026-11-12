/**
 * The event's dates, state and clock as the organiser shell shows them (docs/design/mockups.html,
 * sheet 2): English 24-hour times in the event's time zone. kit-py's `canccu_kit.ui_base` writes
 * the same.
 */
import { html, type Html } from "./html.js";

/** The event as `GET /api/tenants/current` describes it to anyone (contracts/tenants.md). */
export interface EventInfo {
  name?: string | undefined;
  status: "draft" | "live" | "archived";
  timeZone: string;
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
  venue?: string | null | undefined;
}

// The event's language decides the format (UX audit B5); English is the only one until step 10.
function parts(iso: string, timeZone: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
}

/** "18:42", in the event's time zone. */
export function timeLabel(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone);
  return `${p.hour}:${p.minute}`;
}

/** "Sat 14 Mar", in the event's time zone. */
export function dayLabel(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** The event's days: "Sat 14 – Sun 15 Mar", or "" without dates. */
export function dateRange(event: EventInfo): string {
  if (!event.startsAt) return "";
  const a = parts(event.startsAt, event.timeZone);
  if (!event.endsAt) return dayLabel(event.startsAt, event.timeZone);
  const b = parts(event.endsAt, event.timeZone);
  if (a.day === b.day && a.month === b.month) return `${a.weekday} ${a.day} ${a.month}`;
  if (a.month === b.month) return `${a.weekday} ${a.day} – ${b.weekday} ${b.day} ${b.month}`;
  return `${a.weekday} ${a.day} ${a.month} – ${b.weekday} ${b.day} ${b.month}`;
}

const upcoming = (event: EventInfo, now: Date): boolean =>
  event.status !== "archived" && !!event.startsAt && now < new Date(event.startsAt);

/** "UTC", "EET": the zone's short name at that moment. */
function zoneLabel(at: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" });
  return fmt.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

/**
 * The event clock, "18:42 UTC", as the page was drawn; before the event starts there is none
 * (the badge says when it starts).
 */
export function eventClock(event: EventInfo, now: Date = new Date()): Html {
  if (upcoming(event, now)) return html``;
  const at = now.toISOString();
  return html`<time class="canccu-clock" datetime="${at}">${timeLabel(at, event.timeZone)}<small>${zoneLabel(now, event.timeZone)}</small></time>`;
}

/** Live, Starts <day>, Archived or Draft, as a badge. */
export function stateBadge(event: EventInfo, now: Date = new Date()): Html {
  const badge = (kind: string, text: string): Html =>
    html`<span class="${kind ? `canccu-badge ${kind}` : "canccu-badge"}">${text}</span>`;
  if (event.status === "archived") return badge("canccu-badge--plain", "Archived");
  if (event.startsAt && upcoming(event, now)) {
    return badge(
      "canccu-badge--primary",
      `Starts ${parts(event.startsAt, event.timeZone).weekday}`,
    );
  }
  return event.status === "live" ? badge("canccu-badge--ok", "Live") : badge("", "Draft");
}
