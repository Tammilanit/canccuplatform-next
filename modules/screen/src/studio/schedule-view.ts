/**
 * The Studio's schedule page (plan #190, S2–S3; mockup 09): the week calendar of the event's days
 * with one lane per zone, and beside it what plays now, the breaks and the conflicts. Read-only;
 * the window editor and "what plays at…" are #267's. The Studio's CSP refuses inline styles, so a
 * block's place goes into the page's nonce'd style block, keyed by the block's id, as numbers only.
 */
import { attrs, dayLabel, emptyState, html, timeLabel } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import type { PlaylistView } from "../content/playlists.js";
import type { Calendar } from "../content/calendar.js";
import type { Span, ZoneCalendar } from "../schedule/calendar.js";
import { breakOverlaps } from "./break-overlap.js";
import { placement } from "./calendar-pointer.js";
import { counted } from "./messages.js";
import type { MessageKey } from "./messages.js";
import type { ScheduleBlock, ScheduleModel, ScheduleRow } from "./schedule-model.js";
import { zoneInsight } from "./schedule-insights.js";
import { STUDIO } from "./views.js";
import type { ViewContext, ZoneSummary } from "./views.js";

export interface ScheduleViewData {
  model: ScheduleModel;
  calendar: Calendar;
  /** Every zone of the event, for the filter. */
  zones: readonly ZoneSummary[];
  /** The zone shown, or every zone. */
  zone: string | undefined;
  page: { days: string[]; prev: string | null; next: string | null };
  playlists: ReadonlyMap<string, Pick<PlaylistView, "name" | "break">>;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** Lines per side-panel list before "and N more": the panel stays readable on a phone. */
const LIST_MAX = 6;
const ID = "canccu-sched-";

/** A date column's label, read at noon UTC so no time zone moves it to another day. */
const dateLabel = (date: string): string => dayLabel(`${date}T12:00:00Z`, "UTC");

export function scheduleView(c: ViewContext, d: ScheduleViewData): { body: Html; style: string } {
  const rules: string[] = [];
  const place = (id: string, start: number, end: number) => {
    const p = placement(start, end);
    rules.push(`#${id}{top:${p.top.toFixed(4)}%;height:${p.height.toFixed(4)}%}`);
  };
  const empty = d.model.days.every((day) => day.lanes.every((l) => l.blocks.length === 0));
  const body = html`<div class="canccu-sched">
    ${toolbar(c, d)}
    <div class="canccu-sched__layout">
      <div class="canccu-sched__main">
        ${
          empty
            ? emptyState({
                icon: "calendar",
                title: c.t("schedule.empty_title"),
                text: c.t("schedule.empty_text"),
              })
            : ""
        }
        ${grid(c, d, place, rules)}
      </div>
      <aside class="canccu-sched__side">${side(c, d)}</aside>
    </div>
  </div>`;
  return { body, style: rules.join("") };
}

function toolbar(c: ViewContext, d: ScheduleViewData): Html {
  const { t } = c;
  const link = (q: { zone?: string | undefined; from?: string | null }) => {
    const params = new URLSearchParams();
    if (q.zone !== undefined) params.set("zone", q.zone);
    if (q.from) params.set("from", q.from);
    const query = params.toString();
    return `${STUDIO}schedule${query === "" ? "" : `?${query}`}`;
  };
  const from = d.page.days[0] ?? null;
  const chip = (label: string, zone: string | undefined) =>
    html`<a${attrs({
      class: `canccu-button canccu-button--${zone === d.zone ? "primary" : "secondary"}`,
      href: link({ zone, from }),
      "aria-current": zone === d.zone ? "page" : undefined,
    })}>${label}</a>`;
  const step = (to: string | null, label: MessageKey, iconName: string) =>
    to === null
      ? ""
      : html`<a${attrs({
          class: "canccu-button canccu-button--secondary",
          href: link({ zone: d.zone, from: to }),
          "aria-label": t(label),
        })}><span class="canccu-i canccu-i--${iconName}" aria-hidden="true"></span></a>`;
  const first = d.page.days[0];
  const last = d.page.days.at(-1);
  return html`<div class="canccu-sched__bar">
    <nav class="canccu-cluster" aria-label="${t("schedule.zone_filter")}">
      ${chip(t("schedule.all_zones"), undefined)}${d.zones.map((z) => chip(z.name, z.key))}
    </nav>
    <nav class="canccu-cluster canccu-sched__days" aria-label="${t("schedule.week")}">
      ${step(d.page.prev, "schedule.prev", "left")}
      <strong
        >${first === undefined ? "" : dateLabel(first)}${last !== undefined && last !== first ? ` – ${dateLabel(last)}` : ""}</strong
      >
      ${step(d.page.next, "schedule.next", "right")}
    </nav>
    <p class="canccu-small canccu-muted">${t("schedule.tz", { tz: d.calendar.time_zone })}</p>
  </div>`;
}

function grid(
  c: ViewContext,
  d: ScheduleViewData,
  place: (id: string, start: number, end: number) => void,
  rules: string[],
): Html {
  const { t } = c;
  const first = d.page.days[0] ?? "";
  const last = d.page.days.at(-1) ?? "";
  let n = 0;
  const columns = d.model.days.map((day) => {
    const lanes = day.lanes.map((lane) => {
      const bands = lane.breaks.map((b) => {
        const id = `${ID}${(n += 1)}`;
        place(id, b.startMinute, b.endMinute);
        return html`<div${attrs({ id, class: "canccu-sched__break", title: t("schedule.breaks_band") })}></div>`;
      });
      const blocks = lane.blocks.map((block) => {
        const id = `${ID}${(n += 1)}`;
        place(id, block.startMinute, block.endMinute);
        return blockView(c, id, block);
      });
      let now: Slot = "";
      if (d.model.now !== null && d.model.now.date === day.date) {
        const id = `${ID}${(n += 1)}`;
        rules.push(
          `#${id}{top:${placement(d.model.now.minute, d.model.now.minute).top.toFixed(4)}%}`,
        );
        now = html`<div${attrs({ id, class: "canccu-sched__now" })}><span>${t("schedule.now_line", { time: timeLabel(new Date(c.nowMs).toISOString(), c.timeZone) })}</span></div>`;
      }
      return html`<div class="canccu-sched__lane">
        ${day.lanes.length > 1 ? html`<p class="canccu-sched__lane-name">${lane.zoneName}</p>` : ""}
        <div class="canccu-sched__track">${bands}${blocks}${now}</div>
      </div>`;
    });
    return html`<section class="canccu-sched__day">
      <h2 class="canccu-sched__date">${dateLabel(day.date)}</h2>
      <div class="canccu-sched__lanes">${lanes}</div>
    </section>`;
  });
  return html`<div
    class="canccu-sched__scroll"
    role="region"
    tabindex="0"
    aria-label="${t("schedule.calendar", { first: dateLabel(first), last: dateLabel(last) })}"
  >
    <div class="canccu-sched__grid">
      <div class="canccu-sched__hours" aria-hidden="true">
        ${HOURS.map((h) => html`<span>${String(h).padStart(2, "0")}:00</span>`)}
      </div>
      ${columns}
    </div>
  </div>`;
}

function blockView(c: ViewContext, id: string, block: ScheduleBlock): Html {
  const [winner, ...losers] = block.rows;
  if (winner === undefined) return html``;
  const times = `${timeLabel(block.startsAt, c.timeZone)}–${timeLabel(block.endsAt, c.timeZone)}`;
  const lines = [
    `${winner.playlistName} · ${times}`,
    rowNote(c, winner),
    ...losers.map((l) => `${l.playlistName}: ${c.t(`schedule.lost.${l.lostOn ?? "id"}`)}`),
  ];
  const cls = [
    "canccu-sched__block",
    losers.length > 0 ? "canccu-sched__block--overlap" : "",
    block.continuesBefore ? "canccu-sched__block--from-before" : "",
    block.continuesAfter ? "canccu-sched__block--to-after" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return html`<div${attrs({ id, class: cls, title: lines.join("\n") })}>
    <p class="canccu-sched__name">${winner.playlistName}</p>
    <p class="canccu-sched__note">${times} · ${rowNote(c, winner)}</p>
    ${losers.map(
      (l) =>
        html`<p class="canccu-sched__loser">
          ${l.playlistName} · ${c.t(`schedule.lost.${l.lostOn ?? "id"}`)}
        </p>`,
    )}
  </div>`;
}

/** Its priority, and for a bound window the item it follows. */
function rowNote(c: ViewContext, row: ScheduleRow): string {
  const priority = c.t("schedule.priority", { n: row.priority });
  if (row.boundTo === null) return priority;
  const item =
    row.boundTo.title !== null
      ? c.t("schedule.while", { title: row.boundTo.title })
      : row.boundTo.crew
        ? c.t("schedule.while_crew")
        : c.t("schedule.while_item");
  return `${priority} · ${item}`;
}

/** "Thu 1 Jan 13:00–14:00"; an end at midnight is 24:00 of the day it ends, as the grid draws it. */
function when(c: ViewContext, s: Span): string {
  const day = (iso: string) => dayLabel(iso, c.timeZone);
  const time = (iso: string) => timeLabel(iso, c.timeZone);
  const start = `${day(s.starts_at)} ${time(s.starts_at)}`;
  const midnight = time(s.ends_at) === "00:00" && s.ends_at > s.starts_at;
  const endDay = midnight ? day(new Date(Date.parse(s.ends_at) - 1).toISOString()) : day(s.ends_at);
  const endTime = midnight ? "24:00" : time(s.ends_at);
  return `${start}–${endDay === day(s.starts_at) ? "" : `${endDay} `}${endTime}`;
}

function side(c: ViewContext, d: ScheduleViewData): Html {
  const { t } = c;
  const name = (zone: ZoneCalendar, scheduleId: string | null) => {
    const w = zone.windows.find((x) => x.schedule_id === scheduleId);
    return d.playlists.get(w?.playlist_id ?? "")?.name ?? "";
  };
  const zoneName = (key: string) => d.zones.find((z) => z.key === key)?.name ?? key;
  const range = { starts_at: d.calendar.from, ends_at: d.calendar.to };
  const many = d.calendar.zones.length > 1;
  const heading = (zone: ZoneCalendar) =>
    many ? html`<h3 class="canccu-sched__zone">${zoneName(zone.zone_key)}</h3>` : "";

  const nowCard =
    d.model.now === null
      ? ""
      : html`<section class="canccu-card">
          <h2 class="canccu-card__title">${t("schedule.now")}</h2>
          ${d.calendar.zones.map((zone) => {
            const i = zoneInsight(zone, c.nowMs, range);
            const time = (iso: string) => timeLabel(iso, c.timeZone);
            const plays =
              i.now === null
                ? null
                : { playlist: name(zone, i.now.winner), time: time(i.now.until) };
            const nowText =
              i.now === null || plays === null
                ? t("schedule.idle")
                : i.now.overlapping === 1
                  ? t("schedule.plays", plays)
                  : counted(t, "schedule.plays_over", i.now.overlapping - 1, plays);
            const next =
              i.next === null
                ? ""
                : i.next.winner === null
                  ? t("schedule.next_idle", { time: time(i.next.at) })
                  : t("schedule.next_change", {
                      playlist: name(zone, i.next.winner),
                      time: time(i.next.at),
                    });
            return html`${heading(zone)}
              <p>${nowText}</p>
              ${next === "" ? "" : html`<p class="canccu-small canccu-muted">${next}</p>`}`;
          })}
        </section>`;

  const minutes = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const length = (s: number) =>
    s % 60 === 0 ? t("schedule.min", { n: s / 60 }) : t("schedule.s", { n: s });
  const breaksCard = html`<section class="canccu-card">
    <h2 class="canccu-card__title">${t("schedule.breaks")}</h2>
    <p class="canccu-small canccu-muted">${t("schedule.breaks_desc")}</p>
    ${d.calendar.zones.map((zone) => {
      const lines = zone.breaks.map((b) => {
        const rules = d.playlists.get(b.playlist_id)?.break;
        const hours =
          rules?.window_start_minute == null || rules.window_end_minute == null
            ? t("schedule.break_always")
            : t("schedule.break_hours", {
                start: minutes(rules.window_start_minute),
                end: minutes(rules.window_end_minute),
              });
        const text = t("schedule.break", {
          playlist: d.playlists.get(b.playlist_id)?.name ?? b.playlist_id,
          period: length(b.period_seconds),
          length: length(b.break_seconds),
        });
        return html`<li>${text} · ${hours}</li>`;
      });
      const overlaps = breakOverlaps(zone.breaks).map(
        (o) =>
          html`<li class="canccu-sched__warn">
            ${t("schedule.break_overlap", {
              a: d.playlists.get(o.a)?.name ?? o.a,
              b: d.playlists.get(o.b)?.name ?? o.b,
              when: when(c, o),
            })}
          </li>`,
      );
      return html`${heading(zone)}${
        lines.length === 0
          ? html`<p class="canccu-small">${t("schedule.breaks_none")}</p>`
          : html`<ul class="canccu-sched__list">
              ${lines}${overlaps}
            </ul>`
      }`;
    })}
  </section>`;

  const conflictsCard = html`<section class="canccu-card">
    <h2 class="canccu-card__title">${t("schedule.conflicts")}</h2>
    ${d.calendar.zones.map((zone) => {
      const i = zoneInsight(zone, c.nowMs, range);
      const items = [
        ...i.conflicts.map((x) => ({
          at: x.starts_at,
          text: t("schedule.conflict", {
            when: when(c, x),
            loser: name(zone, x.loser),
            winner: name(zone, x.winner),
            rule: t(`schedule.lost.${x.lost_on}`),
          }),
        })),
        ...i.gaps.map((g) => ({ at: g.starts_at, text: t("schedule.gap", { when: when(c, g) }) })),
      ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      const shown = items.slice(0, LIST_MAX).map((x) => html`<li>${x.text}</li>`);
      const more =
        items.length > LIST_MAX
          ? html`<li class="canccu-muted">
              ${t("schedule.more", { n: items.length - LIST_MAX })}
            </li>`
          : "";
      return html`${heading(zone)}${
        items.length === 0
          ? html`<p class="canccu-small">${t("schedule.conflicts_none")}</p>`
          : html`<ul class="canccu-sched__list">
              ${shown}${more}
            </ul>`
      }`;
    })}
  </section>`;

  return html`${nowCard}${breaksCard}${conflictsCard}`;
}
