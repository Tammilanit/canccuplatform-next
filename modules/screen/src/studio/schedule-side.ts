/**
 * The schedule page's side panel (plan #190, S3; mockup 09): what plays now in each zone shown,
 * "what plays at…" (#267), the break playlists and where they share time, and the conflicts and
 * gaps, in plain words.
 */
import { dayLabel, html, timeLabel } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { Span, ZoneCalendar } from "../schedule/calendar.js";
import { breakOverlaps } from "./break-overlap.js";
import { counted } from "./messages.js";
import { zoneInsight } from "./schedule-insights.js";
import type { ScheduleViewData } from "./schedule-view.js";
import type { ViewContext } from "./views.js";

/** Lines per side-panel list before "and N more": the panel stays readable on a phone. */
const LIST_MAX = 6;

/** "Thu 1 Jan 13:00–14:00"; an end at midnight is 24:00 of the day it ends, as the grid draws it. */
export function when(c: ViewContext, s: Span): string {
  const day = (iso: string) => dayLabel(iso, c.timeZone);
  const time = (iso: string) => timeLabel(iso, c.timeZone);
  const start = `${day(s.starts_at)} ${time(s.starts_at)}`;
  const midnight = time(s.ends_at) === "00:00" && s.ends_at > s.starts_at;
  const endDay = midnight ? day(new Date(Date.parse(s.ends_at) - 1).toISOString()) : day(s.ends_at);
  const endTime = midnight ? "24:00" : time(s.ends_at);
  return `${start}–${endDay === day(s.starts_at) ? "" : `${endDay} `}${endTime}`;
}

export function side(c: ViewContext, d: ScheduleViewData): Html {
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

  return html`${nowCard}${d.at}${breaksCard}${conflictsCard}`;
}
