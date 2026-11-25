/**
 * Food → Settings (mockup 17, the admin control room's sheet 06): each field drawn with the shared
 * settings controls of packages/ui, as admin's forms draw theirs (#732), so a module's Settings tab
 * looks like every other: a switch for on/off, chips for a choice, a stepper with its range for a
 * count, quick picks and a stepper for a duration, and a help line saying what it is for and its
 * default. The fields post as they always did (`on`/`off`, whole numbers), so saving is unchanged.
 */
import { attrs, html, notice } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { PROVIDER } from "../reader.js";
import {
  DEFAULT_SETTINGS,
  MONTHLY_LIMIT_BOUNDS,
  NOTE_MAX,
  READS_BOUNDS,
  TIME_BOUNDS,
} from "../settings.js";
import type { TimeKey } from "../settings.js";
import { PREFIX, formKey } from "./kit.js";
import type { PageCtx } from "./kit.js";
import type { MessageKey } from "./messages.js";
import { flash } from "./order-view.js";

type Values = Record<string, unknown>;
export const TIMES = Object.keys(TIME_BOUNDS) as TimeKey[];
export const COUNTS = {
  max_open_orders: [1, 20],
  max_items_per_person: [1, 20],
  ai_reader_daily_reads: READS_BOUNDS,
  ai_reader_monthly_limit_usd: MONTHLY_LIMIT_BOUNDS,
} as const;
type CountKey = keyof typeof COUNTS;

/** The durations people pick most, as admin's forms offer them; a field shows those in bounds. */
const PICKS = [1, 5, 10, 15, 30, 60, 90, 120, 240, 480, 720, 1440];
const MOST_PICKS = 6;

/** The minutes as people read them: "10 min", "2 h", "1 h 30 min". */
export function duration(c: PageCtx, minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return c.t("time.min", { n: m });
  return m === 0 ? c.t("time.h", { n: h }) : c.t("time.h_min", { h, m });
}

/** At most six picks inside the bounds, spread over the range. */
function picksFor(min: number, max: number): number[] {
  const fits = PICKS.filter((n) => n >= min && n <= max);
  if (fits.length <= MOST_PICKS) return fits;
  const last = fits.length - 1;
  return Array.from(
    { length: MOST_PICKS },
    (_, i) => fits[Math.round((i * last) / (MOST_PICKS - 1))] ?? 0,
  );
}

const fid = (key: string) => `pizza-${key}`;
const hint = (...parts: string[]) =>
  html`<p class="canccu-field__hint">${parts.filter((p) => p !== "").join(" ")}</p>`;

function section(c: PageCtx, title: MessageKey, desc: MessageKey, fields: Html): Html {
  // A heading and space part the sections, never a frame each (amendment 3, #771).
  return html`<section class="pizza-part">
    <h2 class="pizza-part__title">${c.t(title)}</h2>
    <p class="pizza-part__desc">${c.t(desc)}</p>
    <div class="canccu-form">${fields}</div>
  </section>`;
}

/** The form's fields, for the values read from admin (defaults where none is saved). */
function fields(c: PageCtx, v: Values) {
  const sw = (key: keyof typeof DEFAULT_SETTINGS, label: MessageKey, help: MessageKey) =>
    html`<div class="canccu-field canccu-field--check">
      <input type="hidden" name="${key}" value="off" /><input${attrs({
        class: "canccu-switch",
        type: "checkbox",
        role: "switch",
        id: fid(key),
        name: key,
        value: "on",
        checked: v[key] === true,
      })} /><label class="canccu-field__label" for="${fid(key)}">${c.t(label)}</label>
      ${hint(
        c.t(help),
        c.t("settings.default", {
          value: c.t(DEFAULT_SETTINGS[key] === true ? "settings.on" : "settings.off"),
        }),
      )}
    </div>`;
  const stepper = (key: string, min: number, max: number, unit: string) => {
    const button = (step: number, words: MessageKey, sign: string) =>
      html`<button
        type="button"
        class="canccu-stepper__button"
        data-canccu-step="${step}"
        data-canccu-for="${fid(key)}"
        aria-label="${c.t(words)}"
      >
        ${sign}
      </button>`;
    const input = html`<input${attrs({
      class: "canccu-input",
      type: "number",
      inputmode: "numeric",
      id: fid(key),
      name: key,
      min,
      max,
      step: 1,
      value: Number(v[key]),
      required: true,
    })} />`;
    return html`<span class="canccu-stepper"
      >${button(-1, "settings.less", "−")}${
        unit === ""
          ? input
          : html`<span class="canccu-inputgroup"
              >${input}<span class="canccu-inputgroup__add">${unit}</span></span
            >`
      }${button(1, "settings.more", "+")}</span
    >`;
  };
  const count = (key: CountKey, label: MessageKey, help: MessageKey) => {
    const [min, max] = COUNTS[key];
    return html`<div class="canccu-field">
      <label class="canccu-field__label" for="${fid(key)}">${c.t(label)}</label>
      ${stepper(key, min, max, "")}
      ${hint(
        c.t(help),
        c.t("settings.range", { min, max }),
        c.t("settings.default", { value: DEFAULT_SETTINGS[key] }),
      )}
    </div>`;
  };
  const time = (key: TimeKey) => {
    const [min, max] = TIME_BOUNDS[key];
    return html`<div class="canccu-field">
      <label class="canccu-field__label" for="${fid(key)}"
        >${c.t(`settings.${key}` as MessageKey)}</label
      >
      ${stepper(key, min, max, c.t("settings.min_unit"))}
      <div class="canccu-chips canccu-field__picks">
        ${picksFor(min, max).map(
          (n) =>
            html`<button
              type="button"
              class="canccu-chip"
              data-canccu-for="${fid(key)}"
              data-canccu-pick="${n}"
            >
              ${duration(c, n)}
            </button>`,
        )}
      </div>
      ${hint(
        c.t(`settings.${key}_hint` as MessageKey),
        c.t("settings.range", { min: duration(c, min), max: duration(c, max) }),
        c.t("settings.default", { value: duration(c, DEFAULT_SETTINGS[key]) }),
      )}
    </div>`;
  };
  const by = v.open_by === "crew" ? "crew" : "anyone";
  const chip = (value: "anyone" | "crew", label: MessageKey) =>
    html`<label class="canccu-chip"
      ><input${attrs({
        type: "radio",
        name: "open_by",
        value,
        checked: by === value,
      })} />${c.t(label)}</label
    >`;
  const note = typeof v.ordering_note === "string" ? v.ordering_note : "";
  const ordering = html`${sw("ordering_open", "settings.ordering_open", "settings.ordering_open_hint")}
    <div class="canccu-field">
      <label class="canccu-field__label" for="${fid("ordering_note")}"
        >${c.t("settings.ordering_note")}</label
      ><input${attrs({
        class: "canccu-input",
        id: fid("ordering_note"),
        name: "ordering_note",
        maxlength: NOTE_MAX,
        placeholder: c.t("settings.ordering_note_example"),
        value: note,
      })} />
      ${hint(c.t("settings.ordering_note_hint"))}
    </div>
    <fieldset class="canccu-field">
      <legend class="canccu-field__label">${c.t("settings.open_by")}</legend>
      <div class="canccu-chips">
        ${chip("anyone", "settings.anyone")}${chip("crew", "settings.crew_only")}
      </div>
      ${hint(
        c.t("settings.open_by_hint"),
        c.t("settings.default", { value: c.t("settings.anyone") }),
      )}
    </fieldset>
    ${count("max_open_orders", "settings.max_open_orders", "settings.max_open_orders_hint")}
    ${count("max_items_per_person", "settings.max_items_per_person", "settings.max_items_per_person_hint")}`;
  const times = html`${TIMES.map(time)}
  ${sw("auto_close", "settings.auto_close", "settings.auto_close_hint")}
  ${sw("close_forgotten", "settings.close_forgotten", "settings.close_forgotten_hint")}`;
  const settling = html`<p class="canccu-field__hint">
      ${c.t("settings.organiser")}, ${c.t("settings.organiser_hint")}
    </p>
    ${sw("settle_to_payer", "settings.settle_to_payer", "settings.settle_to_payer_hint")}`;
  const reader = html`${sw("ai_reader", "settings.ai_reader", "settings.ai_reader_hint")}
  ${notice({
    kind: "info",
    title: c.t("settings.reader_outside"),
    text: c.t("settings.reader_cost", { provider: PROVIDER.name, model: PROVIDER.model }),
  })}
  ${count("ai_reader_daily_reads", "settings.ai_reader_daily_reads", "settings.ai_reader_daily_reads_hint")}
  ${count("ai_reader_monthly_limit_usd", "settings.ai_reader_monthly_limit_usd", "settings.ai_reader_monthly_limit_usd_hint")}`;
  return { ordering, times, settling, reader };
}

/**
 * The form. `write`: the person may save (`admin.settings.write`); without it the fields are read
 * only and there is no save bar. `reader`: the AI reader's fields, once an admin set its key.
 */
export function settingsForm(
  c: PageCtx,
  s: { values: Values; version: number; reader: boolean; write: boolean; error?: string },
): Html {
  const f = fields(c, { ...DEFAULT_SETTINGS, ...s.values });
  return html`${flash(s.error)}
    <form method="post" action="${PREFIX}crew/settings" class="canccu-settings">
      ${formKey()}<input type="hidden" name="settings_version" value="${s.version}" />
      <fieldset class="pizza-settings" ${s.write ? "" : html` disabled`}>
        ${section(c, "settings.ordering", "settings.ordering_desc", f.ordering)}
        ${section(c, "settings.settling", "settings.settling_desc", f.settling)}
        ${section(c, "settings.times", "settings.times_desc", f.times)}
        ${s.reader ? section(c, "settings.reader", "settings.reader_desc", f.reader) : ""}
      </fieldset>
      ${
        s.write
          ? html`<div class="canccu-savebar">
              <span class="canccu-savebar__text">${c.t("settings.saved_where")}</span>
              <a class="canccu-button canccu-button--secondary" href="${PREFIX}crew/settings"
                >${c.t("settings.cancel")}</a
              >
              <button class="canccu-button canccu-button--primary" type="submit">
                ${c.t("settings.save")}
              </button>
            </div>`
          : html`<p class="canccu-muted">${c.t("settings.read_only")}</p>`
      }
    </form>`;
}
