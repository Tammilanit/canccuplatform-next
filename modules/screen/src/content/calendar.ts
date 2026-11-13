/**
 * The schedule calendar's read (`GET /api/screen/schedules/calendar`, contracts/screen.md,
 * Schedule windows): the event's windows, break playlists and run-of-show copy, through the same
 * read the tick uses, built per zone by `zoneCalendar`. The Studio's schedule page calls it too,
 * so the page and the API answer from one rule.
 */
import type { SqlClient } from "@canccu/kit";
import { zoneCalendar } from "../schedule/calendar.js";
import type { ZoneCalendar } from "../schedule/calendar.js";
import { invalidRequest, unknownZone } from "../http.js";
import { loadContent } from "../tick/content.js";
import { loadAgendaLabels } from "./agenda.js";

/** The contract's bound on one answer, so no request asks the scheduler for an unbounded walk. */
export const MAX_CALENDAR_DAYS = 31;

export interface Calendar {
  from: string;
  to: string;
  time_zone: string;
  zones: ZoneCalendar[];
}

/** `from` and `to` as instants, or 400: both RFC 3339, `to` after `from`, at most 31 days apart. */
export function calendarRange(from: unknown, to: unknown): { from: Date; to: Date } {
  const fromMs = typeof from === "string" ? Date.parse(from) : NaN;
  const toMs = typeof to === "string" ? Date.parse(to) : NaN;
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    throw invalidRequest("`from` and `to` must be times (RFC 3339).");
  }
  if (toMs <= fromMs) throw invalidRequest("`to` must be after `from`.");
  if (toMs - fromMs > MAX_CALENDAR_DAYS * 24 * 60 * 60 * 1000) {
    throw invalidRequest(`A calendar spans at most ${MAX_CALENDAR_DAYS} days.`);
  }
  return { from: new Date(fromMs), to: new Date(toMs) };
}

export interface CalendarQuery {
  from: Date;
  to: Date;
  timeZone: string;
  /** One zone, or every zone of the event. */
  zone?: string | undefined;
  /** The caller holds `agenda.crew.read`. */
  revealCrew: boolean;
}

export async function readCalendar(c: SqlClient, q: CalendarQuery): Promise<Calendar> {
  // The calendar needs no asset facts, so it skips reading them.
  const content = await loadContent(c, () => Promise.resolve(new Map()), q.from.getTime());
  const labels = await loadAgendaLabels(c);
  const crewItems = new Set([...labels].filter(([, l]) => l.crew).map(([id]) => id));
  const zones = content.zones.filter((z) => q.zone === undefined || z.key === q.zone);
  if (q.zone !== undefined && zones.length === 0) throw unknownZone();
  return {
    from: q.from.toISOString(),
    to: q.to.toISOString(),
    time_zone: q.timeZone,
    zones: zones.map((z) =>
      zoneCalendar(
        {
          zoneKey: z.key,
          windows: content.windows,
          timeZone: q.timeZone,
          agendaItems: content.agendaItems,
          playlistPriorities: content.playlistPriorities,
          breakPlaylists: content.breakPlaylists,
          crewItems,
          revealCrew: q.revealCrew,
        },
        q.from,
        q.to,
      ),
    ),
  };
}
