/**
 * The Studio's schedule page (plan #190, S2–S3; mockup 09): one zone's week calendar on the hours
 * that matter, a key to what it draws, and beside it what plays now, the breaks and the conflicts.
 * A block says one line (playlist and time), a second when it is tall enough, and the rest on
 * hover (its title) or tap (a popover, which needs no script). For writers (#267) the page adds
 * the window editor: the button, the dialog, an Edit button in each popover, and the marks
 * static/studio-schedule.js drags by (a weekly window's block, its lower edge, each column's date
 * and lane's zone, the axis's minutes); a bound window moves with its item, so it only opens. On a phone one day shows, picked with the day switch. The
 * Studio's CSP refuses inline styles, so places go into the page's nonce'd style block, keyed by
 * id, as numbers only.
 */
import { attrs, dayLabel, emptyState, html, timeLabel } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { PlaylistView } from "../content/playlists.js";
import type { Calendar } from "../content/calendar.js";
import type { Axis } from "./schedule-axis.js";
import { placement } from "./calendar-pointer.js";
import type { MessageKey } from "./messages.js";
import type { ScheduleBlock, ScheduleModel } from "./schedule-model.js";
import type { EditorView } from "./schedule-editor.js";
import { side, when } from "./schedule-side.js";
import { STUDIO } from "./views.js";
import type { ViewContext, ZoneSummary } from "./views.js";

/** The `zone` of the page that shows every zone. */
export const ALL_ZONES = "all";

export interface ScheduleViewData {
  model: ScheduleModel;
  calendar: Calendar;
  /** Every zone of the event, for the picker. */
  zones: readonly ZoneSummary[];
  /** The zone shown, or `ALL_ZONES`. */
  zone: string;
  page: { days: string[]; prev: string | null; next: string | null };
  /** The day a phone shows. */
  day: string;
  playlists: ReadonlyMap<string, Pick<PlaylistView, "name" | "break">>;
  /** The "what plays at…" card. */
  at: Html;
  /** The window editor, for holders of `screen.content.write` only. */
  editor: EditorView | null;
}

/** A block shorter than this has room for its first line only. */
const TWO_LINES = 60;
/** A losing stretch shorter than this is drawn but not labelled. */
const LABELLED = 30;
const ID = "canccu-sched-";

/** A date column's label, read at noon UTC so no time zone moves it to another day. */
const dateLabel = (date: string): string => dayLabel(`${date}T12:00:00Z`, "UTC");

/** Places an element between two minutes of `within` (the axis by default), and across. */
type Place = (
  id: string,
  start: number,
  end: number,
  o?: { across?: [number, number]; within?: [number, number] },
) => void;

export function scheduleView(c: ViewContext, d: ScheduleViewData): { body: Html; style: string } {
  const { axis } = d.model;
  const rules = [`#${ID}0{--canccu-sched-hours:${(axis.endMinute - axis.startMinute) / 60}}`];
  const place: Place = (id, start, end, o = {}) => {
    const [from, to] = o.within ?? [axis.startMinute, axis.endMinute];
    const p = placement(start, end, from, to);
    const x = o.across === undefined ? "" : `;left:${pct(o.across[0])}%;width:${pct(o.across[1])}%`;
    rules.push(`#${id}{top:${pct(p.top)}%;height:${pct(p.height)}%${x}}`);
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
        ${legend(c)} ${grid(c, d, place, rules)}
      </div>
      <aside class="canccu-sched__side">${side(c, d)}</aside>
    </div>
    ${d.editor?.dialog ?? ""}
  </div>`;
  return { body, style: rules.join("") };
}

const pct = (n: number): string => n.toFixed(4);

function link(q: { zone: string; from: string | null; day?: string | undefined }): string {
  const params = new URLSearchParams({ zone: q.zone });
  if (q.from) params.set("from", q.from);
  if (q.day !== undefined) params.set("day", q.day);
  return `${STUDIO}schedule?${params.toString()}`;
}

function toolbar(c: ViewContext, d: ScheduleViewData): Html {
  const { t } = c;
  const from = d.page.days[0] ?? null;
  const chip = (label: string, href: string, current: boolean) =>
    html`<a${attrs({
      class: `canccu-button canccu-button--${current ? "primary" : "secondary"}`,
      href,
      "aria-current": current ? "page" : undefined,
    })}>${label}</a>`;
  const zone = (label: string, key: string) =>
    chip(label, link({ zone: key, from }), key === d.zone);
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
  const daySwitch =
    d.page.days.length < 2
      ? ""
      : html`<nav class="canccu-cluster canccu-sched__switch" aria-label="${t("schedule.day")}">
          ${d.page.days.map((day) =>
            chip(dateLabel(day), link({ zone: d.zone, from, day }), day === d.day),
          )}
        </nav>`;
  return html`<div class="canccu-sched__bar">
      <nav class="canccu-cluster canccu-sched__zones" aria-label="${t("schedule.zone_filter")}">
        <span class="canccu-small canccu-muted">${t("schedule.zone_filter")}</span>
        ${d.zones.map((z) => zone(z.name, z.key))}${zone(t("schedule.all_zones"), ALL_ZONES)}
      </nav>
      <nav class="canccu-cluster canccu-sched__days" aria-label="${t("schedule.week")}">
        ${step(d.page.prev, "schedule.prev", "left")}
        <strong
          >${first === undefined ? "" : dateLabel(first)}${last !== undefined && last !== first ? ` – ${dateLabel(last)}` : ""}</strong
        >
        ${step(d.page.next, "schedule.next", "right")}
      </nav>
      <p class="canccu-small canccu-muted">${t("schedule.tz", { tz: d.calendar.time_zone })}</p>
      ${d.editor?.add ?? ""}
    </div>
    ${daySwitch}`;
}

function legend(c: ViewContext): Html {
  const { t } = c;
  const item = (kind: string, label: string) =>
    html`<li><span class="canccu-sched__swatch canccu-sched__swatch--${kind}"></span>${label}</li>`;
  return html`<ul class="canccu-sched__legend" aria-label="${t("schedule.legend")}">
    ${item("wins", t("schedule.legend_wins"))}${item("loses", t("schedule.legend_loses"))}${item(
      "break",
      t("schedule.breaks_band"),
    )}
  </ul>`;
}

/** The hour labels down the gutter: "07:00" … "23:00", "00:00" … past midnight. */
function hours(axis: Axis): Html[] {
  const out: Html[] = [];
  for (let m = axis.startMinute; m < axis.endMinute; m += 60) {
    out.push(html`<span>${String((m / 60) % 24).padStart(2, "0")}:00</span>`);
  }
  return out;
}

function grid(c: ViewContext, d: ScheduleViewData, place: Place, rules: string[]): Html {
  const { t } = c;
  const { model } = d;
  const first = d.page.days[0] ?? "";
  const last = d.page.days.at(-1) ?? "";
  const many = d.calendar.zones.length > 1;
  let n = 0;
  const next = () => `${ID}${(n += 1)}`;
  // One now line across its day, and one badge with the time in the gutter beside it.
  let badge: Html | string = "";
  let nowId = "";
  if (model.now !== null) {
    const top = pct(
      placement(model.now.minute, model.now.minute, model.axis.startMinute, model.axis.endMinute)
        .top,
    );
    const badgeId = next();
    nowId = next();
    rules.push(`#${badgeId}{top:${top}%}`, `#${nowId}{top:${top}%}`);
    badge = html`<span${attrs({
      id: badgeId,
      class: `canccu-sched__now-badge${model.now.date === d.day ? "" : " canccu-sched__now-badge--off"}`,
    })}>${t("schedule.now_line", { time: timeLabel(new Date(c.nowMs).toISOString(), c.timeZone) })}</span>`;
  }
  const columns = model.days.map((day) => {
    const lanes = day.lanes.map((lane) => {
      const bands = lane.breaks.map((b) => {
        const id = next();
        place(id, b.startMinute, b.endMinute);
        return html`<div${attrs({ id, class: "canccu-sched__break" })}></div>`;
      });
      const blocks = lane.blocks.map((block) =>
        blockView(c, block, next, place, d.editor !== null),
      );
      return html`<div class="canccu-sched__lane" data-zone="${lane.zoneKey}">
        ${bands}
        <div class="canccu-sched__blocks">${blocks}</div>
      </div>`;
    });
    const now =
      model.now?.date === day.date
        ? html`<div${attrs({ id: nowId, class: "canccu-sched__now" })}></div>`
        : "";
    const off = day.date === d.day ? "" : " canccu-sched__day--off";
    // Its least width: enough for every window side by side in its busiest lane, in every lane.
    const across = Math.max(1, ...day.lanes.flatMap((l) => l.blocks.map((b) => b.columns)));
    const id = next();
    rules.push(`#${id}{--canccu-sched-across:${across * day.lanes.length}}`);
    return html`<section id="${id}" class="canccu-sched__day${off}" data-date="${day.date}">
      <div class="canccu-sched__head">
        <h2 class="canccu-sched__date">${dateLabel(day.date)}</h2>
        ${
          many
            ? html`<p class="canccu-sched__lane-names">
                ${day.lanes.map((l) => html`<span>${l.zoneName}</span>`)}
              </p>`
            : ""
        }
      </div>
      <div class="canccu-sched__body">${lanes}${now}</div>
    </section>`;
  });
  return html`<div
    class="canccu-sched__scroll"
    role="region"
    tabindex="0"
    aria-label="${t("schedule.calendar", { first: dateLabel(first), last: dateLabel(last) })}"
  >
    <div
      id="${ID}0"
      class="canccu-sched__grid${many ? " canccu-sched__grid--lanes" : ""}"
      data-axis="${model.axis.startMinute} ${model.axis.endMinute}"
    >
      <div class="canccu-sched__gutter">
        <div class="canccu-sched__head"></div>
        <div class="canccu-sched__hours">
          <div aria-hidden="true">${hours(model.axis)}</div>
          ${badge}
        </div>
      </div>
      ${columns}
    </div>
  </div>`;
}

function blockView(
  c: ViewContext,
  block: ScheduleBlock,
  next: () => string,
  place: Place,
  editable: boolean,
): Html {
  const { t } = c;
  const time = (iso: string) => timeLabel(iso, c.timeZone);
  const id = next();
  const pop = `${id}-about`;
  place(id, block.startMinute, block.endMinute, {
    across: [(block.column / block.columns) * 100, 100 / block.columns],
  });
  const span = `${time(block.startsAt)}–${time(block.endsAt)}`;
  const opening = block.losing[0]?.startsAt === block.startsAt ? block.losing[0] : undefined;
  const second = [
    t("schedule.priority", { n: block.priority }),
    boundNote(c, block),
    opening === undefined ? null : t("schedule.loses_to", { playlist: opening.to }),
  ].filter((x) => x !== null);
  const insets = block.losing.map((l) => {
    const inset = next();
    place(inset, l.startMinute, l.endMinute, { within: [block.startMinute, block.endMinute] });
    const labelled = l !== opening && l.endMinute - l.startMinute >= LABELLED;
    const label = labelled ? t("schedule.loses_to", { playlist: l.to }) : "";
    return html`<span${attrs({ id: inset, class: "canccu-sched__lose" })}>${label}</span>`;
  });
  const losing = block.losing.map((l) =>
    t("schedule.loses_at", {
      when: `${time(l.startsAt)}–${time(l.endsAt)}`,
      playlist: l.to,
      rule: t(`schedule.lost.${l.lostOn}`),
    }),
  );
  const notes = [
    block.continuesBefore ? t("schedule.from_before") : null,
    block.continuesAfter ? t("schedule.to_after") : null,
  ].filter((x) => x !== null);
  const cls = [
    "canccu-sched__block",
    block.endMinute - block.startMinute < TWO_LINES ? "canccu-sched__block--short" : "",
    block.continuesBefore ? "canccu-sched__block--from-before" : "",
    block.continuesAfter ? "canccu-sched__block--to-after" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const title = [`${block.playlistName} · ${span}`, second.join(" · "), ...losing].join("\n");
  // A run carried over from the day before has its start off this column: it opens, never drags.
  const drags = editable && block.boundTo === null && !block.continuesBefore;
  const edit = editable
    ? html`<button${attrs({
        class: "canccu-button canccu-button--secondary canccu-button--sm",
        type: "button",
        "data-window-edit": block.scheduleId,
      })}>${t("window.edit")}</button>`
    : "";
  return html`<button${attrs({
    id,
    type: "button",
    class: cls,
    popovertarget: pop,
    title,
    "data-window": editable ? block.scheduleId : undefined,
    "data-drag": drags,
  })}>
      ${insets}
      <span class="canccu-sched__line"
        ><strong>${block.playlistName}</strong> <span class="canccu-sched__time">${span}</span></span
      >
      <span class="canccu-sched__line canccu-sched__more">${second.join(" · ")}</span>
      ${
        drags && !block.continuesAfter
          ? html`<span class="canccu-sched__resize" data-resize aria-hidden="true"></span>`
          : ""
      }
    </button>
    <div${attrs({ id: pop, class: "canccu-sched__about", popover: true })}>
      <h3 class="canccu-card__title">${block.playlistName}</h3>
      <p>${when(c, { starts_at: block.startsAt, ends_at: block.endsAt })}</p>
      <p class="canccu-small canccu-muted">${[...second, ...notes].join(" · ")}</p>
      ${
        losing.length === 0
          ? ""
          : html`<ul class="canccu-sched__list">
              ${losing.map((x) => html`<li>${x}</li>`)}
            </ul>`
      }
      ${edit}
    </div>`;
}

/** For a bound window, the run-of-show item it follows; a crew item stays unnamed without the right. */
function boundNote(c: ViewContext, block: ScheduleBlock): string | null {
  if (block.boundTo === null) return null;
  if (block.boundTo.title !== null) return c.t("schedule.while", { title: block.boundTo.title });
  return block.boundTo.crew ? c.t("schedule.while_crew") : c.t("schedule.while_item");
}
