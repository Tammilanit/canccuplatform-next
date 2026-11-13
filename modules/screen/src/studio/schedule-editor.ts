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
  const days = [1, 2, 3, 4, 5, 6, 7].map(
    (n) =>
      html`<label class="canccu-studio-pick"
        ><input${attrs({ type: "checkbox", name: "days", value: n, checked: n === d.isoDay })} />${t(`window.day.${n}` as MessageKey)}</label
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
  const dialog = html`<dialog
      class="canccu-studio-dialog"
      id="canccu-sched-editor"
      aria-labelledby="canccu-sched-editor-title"
      data-zone="${d.zone}"
    >
      <form class="canccu-form" method="dialog" novalidate data-window-form>
        <h2
          class="canccu-card__title"
          id="canccu-sched-editor-title"
          data-new="${t("window.new_title")}"
          data-edit="${t("window.edit")}"
        >
          ${t("window.new_title")}
        </h2>
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
          options: d.playlists.map((p) => ({ value: p.id, label: p.name })),
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
          ],
        })}
        <fieldset class="canccu-studio-fieldset">
          <legend class="canccu-field__label">${t("window.kind")}</legend>
          ${kind("weekly", "window.kind_weekly")}${kind("bound", "window.kind_bound")}
        </fieldset>
        <fieldset class="canccu-studio-fieldset" data-kind="weekly">
          <legend class="canccu-field__label">${t("window.days")}</legend>
          <div class="canccu-cluster">${days}</div>
          <div class="canccu-studio-columns">
            <div>${time("start", "window.start", "09:00")}</div>
            <div>${time("end", "window.end", "10:00")}</div>
          </div>
          <p class="canccu-small canccu-muted" id="canccu-sched-times-hint">
            ${t("window.times_hint")}
          </p>
        </fieldset>
        <div class="canccu-field" data-kind="bound" hidden>
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
        <div class="canccu-cluster">
          <button class="canccu-button canccu-button--primary" type="submit">
            ${t("window.save")}</button
          ><button class="canccu-button canccu-button--ghost" type="button" data-close>
            ${t("window.cancel")}</button
          ><button
            class="canccu-button canccu-button--danger"
            type="button"
            data-window-delete
            data-confirm="${t("window.delete_confirm")}"
            hidden
          >
            ${t("window.delete")}
          </button>
        </div>
      </form>
    </dialog>
    <p class="canccu-small canccu-muted canccu-sched__hint">${t("window.drag_hint")}</p>
    ${windowsJson(d.windows)}`;
  return { add, dialog };
}

/** The windows for the script; `<` escaped so no value can close the element. */
function windowsJson(windows: readonly WindowFacts[]): Html {
  return raw(
    `<script type="application/json" id="canccu-sched-windows">${JSON.stringify({ schedules: windows }).replace(/</g, "\\u003c")}</script>`,
  );
}
