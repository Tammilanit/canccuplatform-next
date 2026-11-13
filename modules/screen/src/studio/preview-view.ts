/**
 * The zone editor's preview time and "Preview on a screen…" (mockup 08; contracts/screen.md,
 * Preview time and Preview on a screen; #444). Only the zone's own screens can show its unsaved
 * change: the contract takes a zone whose key is the device's zone. The times are offered by the
 * server in the event's time zone, so the page holds no time-zone arithmetic.
 */
import { attrs, dayLabel, html, timeLabel } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { SeenDevice } from "./help.js";
import type { ViewContext } from "./views.js";

const HOUR_MS = 3_600_000;
/** The preview times offered: now, then each whole hour of the next day. */
const HOURS = 24;

export function previewTimeField(c: ViewContext): Html {
  const { t } = c;
  const first = Math.ceil(c.nowMs / HOUR_MS) * HOUR_MS;
  const times = Array.from({ length: HOURS }, (_, i) =>
    new Date(first + i * HOUR_MS).toISOString(),
  );
  return html`<div class="canccu-field">
    <label class="canccu-field__label" for="zone-preview-at">${t("preview.at")}</label>
    <select class="canccu-input" id="zone-preview-at" data-preview-at>
      <option value="">${t("preview.at_now")}</option>
      ${times.map((iso) => html`<option value="${iso}">${dayLabel(iso, c.timeZone)} ${timeLabel(iso, c.timeZone)}</option>`)}
    </select>
    <p class="canccu-field__hint">${t("preview.at_hint")}</p>
  </div>`;
}

export const previewOnScreenButton = (c: ViewContext): Html =>
  html`<button
    class="canccu-button canccu-button--secondary"
    type="button"
    data-screen-preview-open
  >
    ${c.t("preview.on_screen")}
  </button>`;

/** Under the title while a preview of this zone runs on one of its screens. */
export const previewNotice = (c: ViewContext): Html =>
  html`<div class="canccu-notice canccu-studio-screen-notice" data-screen-preview-notice hidden>
    <div class="canccu-notice__body">
      <p class="canccu-notice__title" data-screen-preview-title></p>
      <p>${c.t("preview.running_text")}</p>
      <div class="canccu-notice__actions">
        <button
          class="canccu-button canccu-button--secondary canccu-button--sm"
          type="button"
          data-screen-preview-end
        >
          ${c.t("preview.end")}
        </button>
      </div>
    </div>
  </div>`;

function screenRow(c: ViewContext, d: SeenDevice, checked: boolean): Html {
  const online = d.health?.online === true;
  return html`<label class="canccu-studio-pick canccu-studio-screen"
    ><input${attrs({ class: "canccu-check", type: "radio", name: "preview_device", value: d.id, disabled: !online, checked: online && checked })} /><span
      ><b>${d.name}</b><br /><span class="canccu-small canccu-muted"
        >${online ? c.t("preview.online") : c.t("preview.offline")}</span
      ></span
    ></label
  >`;
}

/** The dialog: which of the zone's screens, and for how long. */
export function previewDialog(
  c: ViewContext,
  zoneKey: string,
  devices: readonly SeenDevice[],
): Html {
  const { t } = c;
  const own = devices.filter((d) => d.zone_key === zoneKey && d.mirror_of === null);
  const firstOnline = own.find((d) => d.health?.online === true);
  const durations: [string, string][] = [
    ["2", t("preview.minutes", { count: 2 })],
    ["5", t("preview.minutes", { count: 5 })],
    ["", t("preview.until_ended")],
  ];
  return html`<dialog class="canccu-studio-dialog" data-screen-preview-dialog aria-labelledby="zone-preview-title">
    <div class="canccu-stack">
      <h2 class="canccu-card__title" id="zone-preview-title">${t("preview.dialog_title")}</h2>
      <fieldset class="canccu-studio-fieldset">
        <legend class="canccu-field__label">${t("preview.screen")}</legend>
        ${own.length === 0 ? html`<p class="canccu-small canccu-muted">${t("preview.no_screens")}</p>` : own.map((d) => screenRow(c, d, d === firstOnline))}
      </fieldset>
      <fieldset class="canccu-studio-fieldset">
        <legend class="canccu-field__label">${t("preview.for")}</legend>
        <div class="canccu-cluster">
          ${durations.map(([value, label], i) => html`<label class="canccu-studio-pick"><input${attrs({ class: "canccu-check", type: "radio", name: "preview_minutes", value, checked: i === 0 })} />${label}</label>`)}
        </div>
      </fieldset>
      <p class="canccu-small canccu-muted">${t("preview.hint")}</p>
      <p class="canccu-field__error" data-screen-preview-error hidden></p>
      <div class="canccu-cluster canccu-studio-dialog__actions">
        <button class="canccu-button canccu-button--secondary" type="button" data-screen-preview-cancel>${t("preview.cancel")}</button>
        <button${attrs({ class: "canccu-button canccu-button--primary", type: "button", "data-screen-preview-start": true, disabled: firstOnline === undefined })}>${t("preview.start")}</button>
      </div>
    </div>
  </dialog>`;
}
