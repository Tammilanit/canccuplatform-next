/**
 * "What plays at…" on the schedule page (#267, plan #190 S3; mockup 09): a day and time in the
 * event's time zone and a zone, answered by simulate (the API's `GET /schedules/simulate`), and
 * why the winner won, from the calendar's segment at that instant: the same `resolveWinner`
 * judged both, so the reasons never disagree with the answer. A form the page answers itself,
 * so it works without the page's script and holds no time-zone arithmetic in the browser.
 */
import { attrs, dayLabel, html, timeLabel } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { AgendaLabel } from "../content/agenda.js";
import { readCalendar } from "../content/calendar.js";
import { simulateZone } from "../content/schedules.js";
import type { ScheduleDeps } from "../content/schedules.js";
import type { LostOn } from "../schedule/calendar.js";
import type { Simulation } from "../schedule/simulate.js";
import { localClock } from "../schedule/window.js";
import { localDate, wallInstant } from "./schedule-axis.js";
import type { MessageKey } from "./messages.js";
import { STUDIO } from "./views.js";
import type { ViewContext, ZoneSummary } from "./views.js";

/** What the page needs of a window to say what plays: the API's `Schedule`. */
export interface WindowFacts {
  id: string;
  playlist_id: string;
  priority: number;
  layout_id: string | null;
  days?: number[];
  start_minute?: number;
  end_minute?: number;
  agenda_item_id: string | null;
}

export interface WhatPlays {
  /** The `datetime-local` value asked, or now's. */
  value: string;
  zone: string;
  /** Null when nothing was asked; `bad` when the time could not be read. */
  answer: (Simulation & { beat: { schedule_id: string; lost_on: LostOn }[] }) | "bad" | null;
}

const LOCAL_RE = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

/** The event's wall clock at `ms`, as a `datetime-local` value. */
function localValue(ms: number, timeZone: string): string {
  const minute = localClock(new Date(ms), timeZone).minuteOfDay;
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  return `${localDate(ms, timeZone)}T${hh}:${String(minute % 60).padStart(2, "0")}`;
}

export async function readWhatPlays(
  deps: Pick<ScheduleDeps, "db" | "settings">,
  c: ViewContext,
  zone: string | undefined,
  asked: string | undefined,
): Promise<WhatPlays> {
  const value = asked ?? localValue(c.nowMs, c.timeZone);
  if (zone === undefined || asked === undefined) return { value, zone: zone ?? "", answer: null };
  const m = LOCAL_RE.exec(asked);
  if (m === null) return { value: "", zone, answer: "bad" };
  const atMs = wallInstant(m[1] as string, Number(m[2]) * 60 + Number(m[3]), c.timeZone);
  const answer = await simulateZone(deps, c.timeZone, zone, atMs, c.nowMs);
  const calendar = await deps.db.tenant((t) =>
    readCalendar(t, {
      from: new Date(atMs),
      to: new Date(atMs + 60_000),
      zone,
      timeZone: c.timeZone,
      revealCrew: false,
    }),
  );
  const segment = calendar.zones[0]?.segments.find(
    (s) => Date.parse(s.starts_at) <= atMs && atMs < Date.parse(s.ends_at),
  );
  const beat = segment?.winner === answer.schedule_id ? segment.losers : [];
  return { value: asked, zone, answer: { ...answer, beat } };
}

export interface AtNames {
  zones: readonly ZoneSummary[];
  windows: readonly WindowFacts[];
  playlists: ReadonlyMap<string, string>;
  layouts: ReadonlyMap<string, string>;
  labels: ReadonlyMap<string, AgendaLabel>;
  /** The page's own query, kept so asking leaves the calendar where it was. */
  page: { zone: string; from: string | null; day: string };
}

const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** "prio 10 · every Thu 09:00–17:00 · layout: Hero only", or the item a bound window follows. */
function about(c: ViewContext, w: WindowFacts, n: AtNames): string {
  const { t } = c;
  let when: string;
  if (w.agenda_item_id !== null) {
    const label = n.labels.get(w.agenda_item_id);
    const crewHidden = label?.crew === true && !c.rights.has("agenda.crew.read");
    when =
      label?.title != null && !crewHidden
        ? t("schedule.while", { title: label.title })
        : t(label?.crew === false ? "schedule.while_item" : "schedule.while_crew");
  } else {
    const days = (w.days ?? []).map((d) => t(`window.day.${d}` as MessageKey)).join(", ");
    const [start, end] = [clock(w.start_minute ?? 0), clock(w.end_minute ?? 0)];
    when = t("at.every", { days, start, end });
  }
  const layout = w.layout_id === null ? null : (n.layouts.get(w.layout_id) ?? w.layout_id);
  return [t("schedule.priority", { n: w.priority }), when]
    .concat(layout === null ? [] : [t("at.layout", { layout })])
    .join(" · ");
}

function answerView(c: ViewContext, w: WhatPlays, n: AtNames): Html | string {
  const { t } = c;
  const a = w.answer;
  if (a === null) return "";
  if (a === "bad") return html`<p class="canccu-sched__warn" role="alert">${t("at.bad")}</p>`;
  const instant = (iso: string) => `${dayLabel(iso, c.timeZone)} ${timeLabel(iso, c.timeZone)}`;
  const zoneName = n.zones.find((z) => z.key === a.zone_key)?.name ?? a.zone_key;
  const heading = html`<h3 class="canccu-sched__zone">
    ${t("at.heading", { when: instant(a.at), zone: zoneName })}
  </h3>`;
  const next =
    a.next_change_at === null ? t("at.no_next") : t("at.next", { when: instant(a.next_change_at) });
  const window = n.windows.find((x) => x.id === a.schedule_id);
  if (a.playlist_id === null || window === undefined) {
    return html`${heading}
      <p>${t("at.idle")}</p>
      <p class="canccu-small canccu-muted">${next}</p>`;
  }
  // The playlist's name in bold inside the sentence, wherever the language puts it.
  const [before, after] = t("at.plays", { playlist: "\u0001" }).split("\u0001");
  const name = (scheduleId: string) => {
    const playlist = n.windows.find((x) => x.id === scheduleId)?.playlist_id ?? "";
    return n.playlists.get(playlist) ?? playlist;
  };
  const beat = a.beat.map((l) =>
    t("at.beat", { playlist: name(l.schedule_id), rule: t(`schedule.lost.${l.lost_on}`) }),
  );
  return html`${heading}
    <p>${before}<strong>${n.playlists.get(a.playlist_id) ?? a.playlist_id}</strong>${after}</p>
    <p class="canccu-small canccu-muted">${about(c, window, n)}</p>
    <p>${beat.length === 0 ? t("at.alone") : t("at.beats", { list: beat.join(", ") })}</p>
    ${a.in_break ? html`<p>${t("at.break")}</p>` : ""}
    <p class="canccu-small canccu-muted">${next}</p>`;
}

export function whatPlaysCard(c: ViewContext, w: WhatPlays, n: AtNames): Html {
  const { t } = c;
  const hidden = (name: string, value: string | null) =>
    value === null ? "" : html`<input type="hidden" name="${name}" value="${value}" />`;
  return html`<section class="canccu-card" id="canccu-sched-at">
    <h2 class="canccu-card__title">${t("at.title")}</h2>
    <form method="get" action="${STUDIO}schedule" class="canccu-sched__at">
      ${hidden("zone", n.page.zone)}${hidden("from", n.page.from)}${hidden("day", n.page.day)}
      <label class="canccu-field__label" for="canccu-sched-at-when">${t("at.when")}</label>
      <input
        class="canccu-input"
        id="canccu-sched-at-when"
        name="at"
        type="datetime-local"
        value="${w.value}"
        required
      />
      <label class="canccu-field__label" for="canccu-sched-at-zone">${t("at.zone")}</label>
      <select class="canccu-input" id="canccu-sched-at-zone" name="at_zone">
        ${n.zones.map(
          (z) =>
            html`<option${attrs({ value: z.key, selected: z.key === w.zone })}>${z.name}</option>`,
        )}
      </select>
      <button class="canccu-button canccu-button--secondary" type="submit">${t("at.ask")}</button>
    </form>
    <div aria-live="polite">${answerView(c, w, n)}</div>
  </section>`;
}
