/**
 * The window editor on the schedule page (#267, plan #190 S4, S10; mockup 09): one dialog for a
 * new window and for a change, weekly (days, from, until; overnight and 24:00 allowed) or bound
 * to a run-of-show item, with priority, playlist and an optional layout. Only holders of
 * `screen.content.write` get it; static/studio-schedule.js fills it and saves through the API,
 * which checks the right again, audits, and answers 409 to a revision someone else replaced.
 * The windows go to the page as the schedules API answers them, so a save sends the revision
 * this person saw. A crew item is named only to holders of `agenda.crew.read`, as the calendar
 * names it; to anyone else a window bound to one keeps its item without the title.
 */
import { attrs, dayLabel, field, html, raw, timeLabel } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { AgendaChoice } from "../content/agenda.js";
import type { MessageKey } from "./messages.js";
import type { WindowFacts } from "./schedule-at.js";
import type { ViewContext, ZoneSummary } from "./views.js";

export const WRITE = "screen.content.write";

export interface EditorData {
  zones: readonly ZoneSummary[];
  /** The playlists a window may play: every one but the break playlists. */
  playlists: readonly { id: string; name: string }[];
  layouts: readonly { id: string; name: string }[];
  items: readonly AgendaChoice[];
  windows: readonly WindowFacts[];
  /** The zone a new window starts in, and the ISO weekday it starts on. */
  zone: string;
  isoDay: number;
}

export interface EditorView {
  add: Html;
  dialog: Html;
  /** How to drag, under the calendar's key. */
  hint: Html;
}

export function editorView(c: ViewContext, d: EditorData): EditorView {
  const { t } = c;
  const crewReader = c.rights.has("agenda.crew.read");
  const bound = new Set(d.windows.flatMap((w) => w.agenda_item_id ?? []));
  const items = d.items.flatMap((i) => {
    if (i.crew && !crewReader) {
      // Kept only so a window bound to it opens as it is; never offered.
      return bound.has(i.id)
        ? [html`<option${attrs({ value: i.id, hidden: true })}>${t("window.crew_item")}</option>`]
        : [];
    }
    const label = t("window.item_label", {
      title: i.title ?? t("window.untitled"),
      when: `${dayLabel(i.startsAt, c.timeZone)} ${timeLabel(i.startsAt, c.timeZone)}`,
    });
    return [html`<option${attrs({ value: i.id })}>${label}</option>`];
  });
  // A window's layout or playlist that is no longer offered (a layout its theme dropped, a break
  // playlist) stays as a hidden option: without it the select falls back to its first choice, and a
  // Save made to change only the priority would change what the screens show.
  const kept = (
    offered: readonly { id: string }[],
    of: (w: WindowFacts) => string | null,
    label: string,
  ) => {
    const ids = new Set(offered.map((o) => o.id));
    const gone = new Set(d.windows.flatMap((w) => of(w) ?? []).filter((id) => !ids.has(id)));
    return [...gone].map((value) => ({ value, label, hidden: true }));
  };
  // Seven toggles in one row, as the shell's segmented chips: checkboxes under the chips, so the
  // form, the keyboard and a screen reader still treat them as the days they are.
  const days = [1, 2, 3, 4, 5, 6, 7].map(
    (n) =>
      html`<label class="canccu-studio-day"
        ><input${attrs({ type: "checkbox", name: "days", value: n, checked: n === d.isoDay })} /><span
          >${t(`window.day.${n}` as MessageKey)}</span
        ></label
      >`,
  );
  const time = (name: string, label: MessageKey, value: string) =>
    html`<label class="canccu-field__label" for="canccu-sched-${name}">${t(label)}</label
      ><input${attrs({
        class: "canccu-input",
        id: `canccu-sched-${name}`,
        name,
        value,
        inputmode: "numeric",
        pattern: "([01][0-9]|2[0-4]):[0-5][0-9]",
        placeholder: "09:00",
        autocomplete: "off",
        "aria-describedby": "canccu-sched-times-hint",
      })} />`;
  const kind = (value: string, label: MessageKey) =>
    html`<label class="canccu-studio-pick"
      ><input${attrs({ type: "radio", name: "kind", value, checked: value === "weekly" })} />${t(label)}</label
    >`;
  const add = html`<button
    class="canccu-button canccu-button--primary"
    data-window-new
    type="button"
  >
    <span class="canccu-i canccu-i--plus" aria-hidden="true"></span>${t("window.add")}
  </button>`;
  // One markup for both widths: a dialog on a desk, a bottom sheet on a phone (studio.css), with
  // the head and the actions outside the scrolling form so Close, Save and Cancel stay in reach.
  const dialog = html`<dialog
      class="canccu-studio-dialog canccu-studio-sheet"
      id="canccu-sched-editor"
      aria-labelledby="canccu-sched-editor-title"
      data-zone="${d.zone}"
    >
      <form class="canccu-studio-sheet__form" method="dialog" novalidate data-window-form>
        <div class="canccu-studio-sheet__head">
          <h2
            class="canccu-card__title"
            id="canccu-sched-editor-title"
            data-new="${t("window.new_title")}"
            data-edit="${t("window.edit")}"
          >
            ${t("window.new_title")}
          </h2>
          <button class="canccu-button canccu-button--ghost" type="button" data-close>
            <span class="canccu-i canccu-i--close" aria-hidden="true"></span>${t("window.close")}
          </button>
        </div>
        <div class="canccu-studio-sheet__body canccu-form">
          <input type="hidden" name="id" value="" /><input type="hidden" name="revision" value="" />
          ${field({
            name: "zone_key",
            label: t("window.zone"),
            value: d.zone,
            options: d.zones.map((z) => ({ value: z.key, label: z.name })),
          })}
          ${field({
            name: "playlist_id",
            label: t("window.playlist"),
            options: [
              ...d.playlists.map((p) => ({ value: p.id, label: p.name })),
              ...kept(d.playlists, (w) => w.playlist_id, t("window.playlist_kept")),
            ],
          })}
          ${field({
            name: "priority",
            label: t("window.priority"),
            type: "number",
            value: 10,
            hint: t("window.priority_hint"),
          })}
          ${field({
            name: "layout_id",
            label: t("window.layout"),
            value: "",
            options: [
              { value: "", label: t("window.layout_zone") },
              ...d.layouts.map((l) => ({ value: l.id, label: l.name })),
              ...kept(d.layouts, (w) => w.layout_id, t("window.layout_kept")),
            ],
          })}
          <fieldset class="canccu-studio-fieldset">
            <legend class="canccu-field__label">${t("window.kind")}</legend>
            ${kind("weekly", "window.kind_weekly")}${kind("bound", "window.kind_bound")}
          </fieldset>
          <fieldset class="canccu-studio-fieldset" data-kind="weekly">
            <legend class="canccu-field__label">${t("window.days")}</legend>
            <div class="canccu-studio-days">${days}</div>
            <div class="canccu-studio-columns">
              <div>${time("start", "window.start", "09:00")}</div>
              <div>${time("end", "window.end", "10:00")}</div>
            </div>
            <p class="canccu-small canccu-muted" id="canccu-sched-times-hint">
              ${t("window.times_hint")}
            </p>
          </fieldset>
          <div class="canccu-studio-fieldset" data-kind="bound" hidden>
            <label class="canccu-field__label" for="canccu-sched-item">${t("window.item")}</label>
            <select
              class="canccu-input"
              id="canccu-sched-item"
              name="agenda_item_id"
              aria-describedby="canccu-sched-item-hint"
            >
              <option value="">${t("window.item_pick")}</option>
              ${items}
            </select>
            <p class="canccu-small canccu-muted" id="canccu-sched-item-hint">
              ${t("window.item_hint")}
            </p>
          </div>
          <p class="canccu-sched__warn" role="alert" data-window-error hidden></p>
        </div>
        <div class="canccu-studio-sheet__foot">
          <button
            class="canccu-studio-danger-link"
            type="button"
            data-window-delete
            data-confirm="${t("window.delete_confirm")}"
            hidden
          >
            ${t("window.delete")}
          </button>
          <button class="canccu-button canccu-button--ghost" type="button" data-close>
            ${t("window.cancel")}</button
          ><button class="canccu-button canccu-button--primary" type="submit">
            ${t("window.save")}
          </button>
        </div>
      </form>
    </dialog>
    ${windowsJson(d.windows)}`;
  const hint = html`<p class="canccu-small canccu-muted">${t("window.drag_hint")}</p>`;
  return { add, dialog, hint };
}

/** The windows for the script; `<` escaped so no value can close the element. */
function windowsJson(windows: readonly WindowFacts[]): Html {
  return raw(
    `<script type="application/json" id="canccu-sched-windows">${JSON.stringify({ schedules: windows }).replace(/</g, "\\u003c")}</script>`,
  );
}
