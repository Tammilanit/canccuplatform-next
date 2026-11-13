/**
 * "What plays at…" as mockup 09 draws it (#267): one line per region the layout has (the hero's
 * playlist and its item, the rail's now and next, the ticker's line), why a run-of-show delay
 * moved what plays, the next break and the next change, and the zone's virtual screen. Asked
 * with a day of the event and a 24 h time, so every time reads as the platform writes it
 * ("Fri 13 Nov 19:20"), never as a browser's own date picker would. The read is schedule-at.ts.
 */
import { attrs, dayLabel, html, timeLabel } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { AgendaLabel } from "../content/agenda.js";
import type { Answer, WhatPlays, WindowFacts } from "./schedule-at.js";
import { wallInstant } from "./schedule-axis.js";
import type { MessageKey } from "./messages.js";
import { STUDIO, zoneFrame } from "./views.js";
import type { ViewContext, ZoneSummary } from "./views.js";

export interface AtNames {
  zones: readonly ZoneSummary[];
  windows: readonly WindowFacts[];
  playlists: ReadonlyMap<string, string>;
  layouts: ReadonlyMap<string, string>;
  labels: ReadonlyMap<string, AgendaLabel>;
  /** The event's days (`YYYY-MM-DD`), the day select's choices. */
  days: readonly string[];
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

/** A message with the playlist's name in bold, wherever the language puts it. */
function withName(
  c: ViewContext,
  key: MessageKey,
  name: string,
  vars: Record<string, string | number> = {},
): Html {
  const [before, after] = c.t(key, { ...vars, playlist: "\u0001" }).split("\u0001");
  return html`${before}<strong>${name}</strong>${after ?? ""}`;
}

function heroLine(c: ViewContext, a: Answer, n: AtNames): Html | string {
  const { t } = c;
  if (a.playlist_id === null) return t("at.hero_idle");
  const name = n.playlists.get(a.playlist_id) ?? a.playlist_id;
  if (a.in_break) {
    const breakName = a.breakPlaylist?.name ?? null;
    return breakName === null
      ? withName(c, "at.hero_break_any", name)
      : withName(c, "at.hero_break", name, { name: breakName });
  }
  if (a.item === null) return withName(c, "at.hero_plain", name);
  if (a.item === "empty") return withName(c, "at.hero_empty", name);
  return withName(c, "at.hero", name, { n: a.item.index, count: a.item.count });
}

function railLine(c: ViewContext, a: Answer): string {
  const { t } = c;
  if (a.rail === null) return t("at.rail_down");
  const time = (iso: string) => timeLabel(iso, c.timeZone);
  const now = a.rail.now.map((i) => `“${i.title}”`).join(", ");
  const next = a.rail.next && t("at.item_at", { title: a.rail.next.title, time: time(a.rail.next.starts_at) }); // prettier-ignore
  if (now !== "" && next) return t("at.rail", { now, next });
  if (next) return t("at.rail_next", { next });
  if (now !== "") return t("at.rail_now", { now });
  return t("at.rail_none");
}

function tickerLine(c: ViewContext, a: Answer): string {
  const { t } = c;
  const k = a.ticker;
  if (k.text === null || k.source === null) return t("at.ticker_none");
  return t("at.ticker", {
    text: k.text,
    from: t(`ticker.from.${k.source}` as MessageKey),
    until: k.until === null ? t("ticker.no_end") : t("ticker.until", { time: timeLabel(k.until, c.timeZone) }), // prettier-ignore
  });
}

function movedLine(c: ViewContext, a: Answer, n: AtNames): Html | string {
  const m = a.moved;
  if (m === null || m.ends_at === null) return "";
  const playlist = n.windows.find((w) => w.id === m.schedule_id)?.playlist_id ?? "";
  const vars = {
    item: m.title === null ? c.t("at.crew_item") : `“${m.title}”`,
    time: timeLabel(m.ends_at, c.timeZone),
    shift: m.minutes > 0 ? `+${m.minutes}` : `−${-m.minutes}`,
  };
  const key = m.how === "runs" ? "at.moved_runs" : "at.moved_ended";
  return html`<p>${withName(c, key, n.playlists.get(playlist) ?? playlist, vars)}</p>`;
}

function answerView(c: ViewContext, w: WhatPlays, n: AtNames): Html | string {
  const { t } = c;
  const a = w.answer;
  if (a === null) return "";
  if (a === "bad") return html`<p class="canccu-sched__warn" role="alert">${t("at.bad")}</p>`;
  const instant = (iso: string) => `${dayLabel(iso, c.timeZone)} ${timeLabel(iso, c.timeZone)}`;
  const zoneName = n.zones.find((z) => z.key === a.zone_key)?.name ?? a.zone_key;
  const window = n.windows.find((x) => x.id === a.schedule_id);
  const name = (scheduleId: string) => {
    const playlist = n.windows.find((x) => x.id === scheduleId)?.playlist_id ?? "";
    return n.playlists.get(playlist) ?? playlist;
  };
  const beat = a.beat.map((l) =>
    t("at.beat", { playlist: name(l.schedule_id), rule: t(`schedule.lost.${l.lost_on}`) }),
  );
  const [b, p] = [a.nextBreak, a.breakPlaylist];
  const at = b && { time: timeLabel(b.at, c.timeZone), seconds: b.seconds };
  const breakLine =
    at === null
      ? ""
      : p === null
        ? t("at.break_next_plain", at)
        : t("at.break_next", { ...at, name: p.name, every: Math.round(p.everySeconds / 60) });
  return html`<h3 class="canccu-sched__zone">
      ${t("at.heading", { when: instant(a.at), zone: zoneName })}
    </h3>
    <ul class="canccu-sched__regions">
      ${a.roles.has("hero") ? html`<li>${heroLine(c, a, n)}</li>` : ""}
      ${a.roles.has("rail") ? html`<li>${railLine(c, a)}</li>` : ""}
      ${a.roles.has("ticker") ? html`<li>${tickerLine(c, a)}</li>` : ""}
    </ul>
    ${
      window === undefined
        ? ""
        : html`<p class="canccu-small canccu-muted">${about(c, window, n)}</p>
            <p>${beat.length === 0 ? t("at.alone") : t("at.beats", { list: beat.join(", ") })}</p>`
    }
    ${movedLine(c, a, n)} ${breakLine === "" ? "" : html`<p>${breakLine}</p>`}
    <p class="canccu-small canccu-muted">
      ${
        a.next_change_at === null
          ? t("at.no_next")
          : t("at.next", { when: instant(a.next_change_at) })
      }
    </p>
    <p>
      <a${attrs({ class: "canccu-sched__virtual", href: zoneFrame(a.zone_key), target: "_blank", rel: "noopener", "aria-describedby": "canccu-sched-at-virtual" })}
        >${t("at.virtual")} <span aria-hidden="true">▸</span></a
      >
      <span class="canccu-small canccu-muted" id="canccu-sched-at-virtual">${t("at.virtual_hint")}</span>
    </p>`;
}

export function whatPlaysCard(c: ViewContext, w: WhatPlays, n: AtNames): Html {
  const { t } = c;
  const hidden = (name: string, value: string | null) =>
    value === null ? "" : html`<input type="hidden" name="${name}" value="${value}" />`;
  // A day asked outside the event's days (an old link) stays choosable, so the answer matches.
  const days = n.days.includes(w.day) || w.day === "" ? n.days : [...n.days, w.day].sort();
  const dayName = (d: string) => dayLabel(new Date(wallInstant(d, 720, c.timeZone)).toISOString(), c.timeZone); // prettier-ignore
  return html`<section class="canccu-card" id="canccu-sched-at">
    <h2 class="canccu-card__title">${t("at.title")}</h2>
    <form method="get" action="${STUDIO}schedule" class="canccu-sched__at">
      ${hidden("zone", n.page.zone)}${hidden("from", n.page.from)}${hidden("day", n.page.day)}
      <label class="canccu-field__label" for="canccu-sched-at-day">${t("at.day")}</label>
      <select class="canccu-input" id="canccu-sched-at-day" name="at_day">
        ${days.map((d) => html`<option${attrs({ value: d, selected: d === w.day })}>${dayName(d)}</option>`)}
      </select>
      <label class="canccu-field__label" for="canccu-sched-at-time">${t("at.time")}</label>
      <input${attrs({
        class: "canccu-input canccu-num",
        id: "canccu-sched-at-time",
        name: "at",
        value: w.time,
        inputmode: "numeric",
        pattern: "([01][0-9]|2[0-3]):[0-5][0-9]",
        placeholder: "19:20",
        autocomplete: "off",
        required: true,
        "aria-describedby": "canccu-sched-at-hint",
      })} />
      <p class="canccu-small canccu-muted" id="canccu-sched-at-hint">${t("at.time_hint")}</p>
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
