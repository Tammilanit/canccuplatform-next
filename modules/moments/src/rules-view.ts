/**
 * Priorities → Built-in rules (mockup 08, the PO's notes on O5): one row per rule on one shared
 * grid, its regions and zones as chips, its seconds on a slider and its cue picked from the
 * event's cues, so nothing is typed. Server-drawn; the slider's value line is kept live by
 * static/moments.js and reads right without it.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import { CLASSES } from "./arbiter.js";
import { PREFIX } from "./page-kit.js";
import type { RuleView } from "./rules.js";
import { CLASS_NAMES } from "./views.js";

/** The region roles in chain order, biggest first: ticked chips save in this order. */
const REGIONS: [string, string][] = [
  ["full", "Full screen"],
  ["hero", "Hero"],
  ["rail", "Rail"],
  ["venue_rail", "Venue rail"],
  ["ticker", "Ticker"],
  ["overlay", "Overlay"],
];

/** The slider's range: a rule's moment shows up to 10 minutes after its last ask, in 5 s steps. */
export const SECONDS = { min: 5, max: 600, step: 5 };

export function secondsText(n: number): string {
  if (n < 60) return `${String(n)} s`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return s === 0 ? `${String(m)} min` : `${String(m)} min ${String(s)} s`;
}

/** An event name breaks only after a dot, never inside a word (O5). */
const eventName = (type: string): Html =>
  html`<code class="moments-event"
    >${type.split(".").map((part, i, all) => (i < all.length - 1 ? html`${part}.<wbr />` : part))}</code
  >`;

function chips(
  name: string,
  values: [string, string][],
  on: readonly string[],
  disabled: string,
): Html {
  return html`<span class="canccu-chips"
    >${values.map(
      ([v, label]) =>
        html`<label class="canccu-chip"
          ><input
            type="checkbox"
            name="${name}"
            value="${v}"
            ${on.includes(v) ? " checked" : ""}${disabled}
          />${label}</label
        >`,
    )}</span
  >`;
}

function ruleRow(r: RuleView, o: { zones: string[]; cues: string[]; canWrite: boolean }): Html {
  const dis = o.canWrite ? "" : " disabled";
  const id = r.rule_id;
  const classes = CLASSES.filter((c) => c !== "emergency").map(
    (c) =>
      html`<option value="${c}" ${c === r.class ? " selected" : ""}>${CLASS_NAMES[c]}</option>`,
  );
  // A zone the rule names that no screen reported yet stays ticked, so a save keeps it.
  const zones = [...new Set([...o.zones, ...r.zones])].map((z): [string, string] => [z, z]);
  const cues = [...new Set([...o.cues, ...(r.cue === null ? [] : [r.cue])])];
  const max = Math.max(SECONDS.max, Math.ceil(r.ttl_seconds / SECONDS.step) * SECONDS.step);
  return html`<form class="moments-rule" method="post" action="${PREFIX}rules/${id}">
    <input type="hidden" name="revision" value="${r.revision}" /><input
      type="hidden"
      name="template"
      value="${r.template}"
    />
    <div class="moments-rule__name">
      <div class="canccu-field canccu-field--check">
        <input
          class="canccu-check"
          type="checkbox"
          id="on-${id}"
          name="enabled"
          value="true"
          ${r.enabled ? " checked" : ""}${dis}
        />
        <label class="canccu-field__label" for="on-${id}">${id.replaceAll("_", " ")}</label>
      </div>
      <p class="canccu-small canccu-muted">
        On ${r.on.map((t, i) => html`${i === 0 ? "" : ", "}${eventName(t)}`)}
      </p>
    </div>
    <label class="moments-rule__class canccu-small"
      >As
      <select class="canccu-input" name="class" ${dis}>
        ${classes}
      </select></label
    >
    <div class="moments-rule__seconds canccu-small">
      <label for="ttl-${id}">Shows for</label>
      <input
        class="moments-range"
        id="ttl-${id}"
        type="range"
        name="ttl_seconds"
        min="${String(SECONDS.min)}"
        max="${String(max)}"
        step="${String(SECONDS.step)}"
        value="${String(r.ttl_seconds)}"
        data-seconds${dis}
      />
      <output for="ttl-${id}" data-seconds-out>${secondsText(r.ttl_seconds)}</output>
    </div>
    <label class="moments-rule__cue canccu-small"
      >Cue
      <select class="canccu-input" name="cue" ${dis}>
        <option value="">No cue</option>
        ${cues.map((c) => html`<option value="${c}" ${c === r.cue ? " selected" : ""}>${c}</option>`)}
      </select></label
    >
    <fieldset class="moments-fieldset moments-rule__regions">
      <legend class="canccu-small">Regions</legend>
      ${chips("regions", REGIONS, r.regions, dis)}
    </fieldset>
    <fieldset class="moments-fieldset moments-rule__zones">
      <legend class="canccu-small">
        Zones <span class="canccu-muted">(none: every zone)</span>
      </legend>
      ${chips("zones", zones, r.zones, dis)}
    </fieldset>
    ${o.canWrite ? html`<button class="canccu-button canccu-button--secondary canccu-button--sm moments-rule__save" type="submit">Save</button>` : ""}
  </form>`;
}

export function rulesView(
  rules: RuleView[],
  o: { zones: string[]; cues: string[]; canWrite: boolean },
): Html {
  return html`<section class="canccu-card moments-rules">
    <h2 class="canccu-card__title">Built-in rules</h2>
    <p class="canccu-small canccu-muted">
      What fires by itself when the tournament, pizza and games modules report. Each rule's cue is
      set up on the Cues tab: its picture and its sound.
    </p>
    ${rules.map((r) => ruleRow(r, o))}
  </section>`;
}
