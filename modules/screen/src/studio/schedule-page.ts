/**
 * The schedule page's read (plan #190, S2): the event's days paged by week, the calendar answer
 * through the same read as `GET /api/screen/schedules/calendar`, and the names it shows. Mockup 09
 * shows one zone at a time: the page opens on the first zone that has screens, and `zone=all`
 * shows every zone. A zone the event has not (an old link) opens the default zone, not an error.
 */
import type { EventInfo, Html } from "@canccu/ui";
import { loadAgendaLabels } from "../content/agenda.js";
import { readCalendar } from "../content/calendar.js";
import { loadPlaylists } from "../content/playlists.js";
import type { Db } from "../db.js";
import { shownZone } from "./help.js";
import type { SeenDevice } from "./help.js";
import { addDays, clipCalendar, columnSpan, dayStartMs, scheduleAxis } from "./schedule-axis.js";
import { eventDays, pageOfDays, scheduleModel } from "./schedule-model.js";
import { ALL_ZONES, scheduleView } from "./schedule-view.js";
import type { ViewContext, ZoneSummary } from "./views.js";

export interface ScheduleQuery {
  zone?: string | undefined;
  from?: string | undefined;
  /** The day a phone shows. */
  day?: string | undefined;
}

export async function schedulePage(
  db: Db,
  c: ViewContext,
  event: EventInfo,
  zones: readonly ZoneSummary[],
  devices: readonly SeenDevice[],
  query: ScheduleQuery,
): Promise<{ body: Html; style: string }> {
  const tz = c.timeZone;
  const days = eventDays(event.startsAt ?? undefined, event.endsAt ?? undefined, tz, c.nowMs);
  const page = pageOfDays(days, query.from);
  // Only which zones have screens, to open on the first: the page shows no device.
  const screened = new Set(devices.flatMap((d) => shownZone(d, devices) ?? []));
  const fallback = (zones.find((z) => screened.has(z.key)) ?? zones[0])?.key;
  const zone =
    query.zone === ALL_ZONES
      ? undefined
      : zones.some((z) => z.key === query.zone)
        ? query.zone
        : fallback;
  const first = page.days[0] as string;
  const last = page.days.at(-1) as string;
  const [read, playlists, labels] = await db.tenant(
    async (t) =>
      [
        // A day past the last: the axis may run the last column on into the small hours.
        await readCalendar(t, {
          from: new Date(dayStartMs(first, tz)),
          to: new Date(dayStartMs(addDays(last, 2), tz)),
          zone,
          timeZone: tz,
          revealCrew: c.rights.has("agenda.crew.read"),
        }),
        await loadPlaylists(t),
        await loadAgendaLabels(t),
      ] as const,
  );
  const axis = scheduleAxis(read.zones, page.days, tz);
  const calendar = clipCalendar(read, {
    starts_at: columnSpan(first, axis, tz).starts_at,
    ends_at: columnSpan(last, axis, tz).ends_at,
  });
  const model = scheduleModel({
    calendar,
    days: page.days,
    axis,
    zoneNames: new Map(zones.map((z) => [z.key, z.name])),
    playlistNames: new Map(playlists.map((p) => [p.id, p.name])),
    labels,
    nowMs: c.nowMs,
  });
  const day =
    [query.day, model.now?.date].find((d) => d !== undefined && page.days.includes(d)) ?? first;
  return scheduleView(c, {
    model,
    calendar,
    zones,
    zone: zone ?? ALL_ZONES,
    page,
    day,
    playlists: new Map(playlists.map((p) => [p.id, p])),
  });
}
