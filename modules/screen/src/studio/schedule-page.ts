/**
 * The schedule page's read (plan #190, S2): the event's days paged by week, the calendar answer
 * through the same read as `GET /api/screen/schedules/calendar`, and the names it shows. A zone
 * the event has not (an old link) shows every zone rather than an error.
 */
import type { EventInfo, Html } from "@canccu/ui";
import { loadAgendaLabels } from "../content/agenda.js";
import { readCalendar } from "../content/calendar.js";
import { loadPlaylists } from "../content/playlists.js";
import type { Db } from "../db.js";
import { addDays, dayStartMs, eventDays, pageOfDays, scheduleModel } from "./schedule-model.js";
import { scheduleView } from "./schedule-view.js";
import type { ViewContext, ZoneSummary } from "./views.js";

export async function schedulePage(
  db: Db,
  c: ViewContext,
  event: EventInfo,
  zones: readonly ZoneSummary[],
  query: { zone?: string | undefined; from?: string | undefined },
): Promise<{ body: Html; style: string }> {
  const tz = c.timeZone;
  const days = eventDays(event.startsAt ?? undefined, event.endsAt ?? undefined, tz, c.nowMs);
  const page = pageOfDays(days, query.from);
  const zone = zones.some((z) => z.key === query.zone) ? query.zone : undefined;
  const first = page.days[0] as string;
  const last = page.days.at(-1) as string;
  const [calendar, playlists, labels] = await db.tenant(
    async (t) =>
      [
        await readCalendar(t, {
          from: new Date(dayStartMs(first, tz)),
          to: new Date(dayStartMs(addDays(last, 1), tz)),
          zone,
          timeZone: tz,
          revealCrew: c.rights.has("agenda.crew.read"),
        }),
        await loadPlaylists(t),
        await loadAgendaLabels(t),
      ] as const,
  );
  const model = scheduleModel({
    calendar,
    days: page.days,
    zoneNames: new Map(zones.map((z) => [z.key, z.name])),
    playlistNames: new Map(playlists.map((p) => [p.id, p.name])),
    labels,
    nowMs: c.nowMs,
  });
  return scheduleView(c, {
    model,
    calendar,
    zones,
    zone,
    page,
    playlists: new Map(playlists.map((p) => [p.id, p])),
  });
}
