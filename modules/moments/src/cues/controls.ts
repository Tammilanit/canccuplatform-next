/**
 * The sound desk's controls (#626, the step 4 polish sheets 01–04): switches, sliders with their
 * value shown, steppers, meters and the themed players. Each is a plain form control, so the desk
 * works without its script; static/sound-desk.js adds the value as it moves, the steppers' buttons
 * and the players' sound. The CSP allows no style attribute, so heights are classes.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";

const dis = (on: boolean): string => (on ? "" : " disabled");

export const notice = (done?: string, error?: string): Html =>
  html`${done ? html`<p class="canccu-notice canccu-notice--ok" role="status">${done}</p>` : ""}${error ? html`<p class="canccu-notice canccu-notice--down" role="alert">${error}</p>` : ""}`;

/** A two-way switch: a checkbox that reads "on", as the API's forms already post it. */
export function toggle(o: {
  name: string;
  on: boolean;
  label: string;
  enabled: boolean;
  id?: string;
  auto?: boolean;
}): Html {
  return html`<input
    class="moments-switch"
    type="checkbox"
    role="switch"
    name="${o.name}"
    value="on"
    aria-label="${o.label}"
    ${o.id === undefined ? "" : html`id="${o.id}"`}
    ${o.auto === true ? "data-autosubmit" : ""}
    ${o.on ? "checked" : ""}${dis(o.enabled)}
  />`;
}

export type Format = "pct" | "count" | "secs" | "stops";

/** The value as the slider's output says it; the script says the same as the slider moves. */
export function said(format: Format, value: number, stops: number[] = []): string {
  if (format === "pct") return `${String(value)} %`;
  if (format === "count") return String(value);
  const s = format === "stops" ? (stops[value] ?? 0) : value;
  if (s === 0) return "Off";
  if (s < 60 || (format === "secs" && s % 60 !== 0)) return `${String(s)} s`;
  return s % 60 === 0
    ? `${String(s / 60)} min`
    : `${String(Math.floor(s / 60))} min ${String(s % 60)} s`;
}

/** A slider with its value shown in an output beside its label. */
export function slider(o: {
  id: string;
  name: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  format: Format;
  enabled: boolean;
  stops?: number[];
  hideLabel?: boolean;
}): Html {
  const stops = o.stops ?? [];
  return html`<div class="moments-slider">
    <label class="moments-slider__label${o.hideLabel === true ? " moments-said" : ""}" for="${o.id}"
      >${o.label}</label
    ><output class="moments-slider__value" for="${o.id}">${said(o.format, o.value, stops)}</output>
    <input
      class="moments-range"
      type="range"
      id="${o.id}"
      name="${o.name}"
      min="${String(o.min)}"
      max="${String(o.max)}"
      step="${String(o.step ?? 1)}"
      value="${String(o.value)}"
      data-format="${o.format}"
      ${stops.length > 0 ? html`data-stops="${stops.join(",")}"` : ""}${dis(o.enabled)}
    />
  </div>`;
}

/** A number with − and + buttons; the buttons are the script's, the number works without it. */
export function stepper(o: {
  id: string;
  name: string;
  label: string;
  value: number;
  min: number;
  max: number;
  by: number;
  unit: string;
  less: string;
  more: string;
  enabled: boolean;
}): Html {
  return html`<span class="moments-stepper" data-stepper data-by="${String(o.by)}">
    <button class="moments-stepper__button" type="button" aria-label="${o.less}" hidden${dis(o.enabled)}>−</button>
    <input
      class="moments-stepper__input"
      type="number"
      id="${o.id}"
      name="${o.name}"
      min="${String(o.min)}"
      max="${String(o.max)}"
      step="any"
      inputmode="decimal"
      value="${String(o.value)}"
      aria-label="${o.label}"
      ${dis(o.enabled)}
    /><span class="moments-stepper__unit">${o.unit}</span>
    <button class="moments-stepper__button" type="button" aria-label="${o.more}" hidden${dis(o.enabled)}>+</button>
  </span>`;
}

/** A bar for a level or a count, with its words beside it. */
export const meter = (value: number, max: number, label: string): Html =>
  html`<meter class="moments-meter" min="0" max="${String(Math.max(max, 1))}" value="${String(Math.min(value, Math.max(max, 1)))}" aria-label="${label}"></meter>`;

/**
 * A waveform's look for a sound: no file is read for it, so its bars come from the sound's id,
 * the same for the same sound on every page.
 */
function wave(id: string): Html {
  let h = 2166136261;
  const bars: Html[] = [];
  for (let i = 0; i < 28; i++) {
    h = Math.imul(h ^ (id.charCodeAt(i % id.length) + i), 16777619) >>> 0;
    bars.push(html`<i class="moments-wave__bar moments-wave__bar--${String((h % 8) + 1)}"></i>`);
  }
  return html`<span class="moments-wave" aria-hidden="true">${bars}</span>`;
}

/** A themed player: play and stop, the waveform and the length; one plays at a time (the script). */
export function player(o: {
  id: string;
  title: string;
  url: string;
  length_ms: number;
  level?: number;
  compact?: boolean;
  extra?: Html;
}): Html {
  const label = `Play ${o.title}`;
  if (o.compact === true)
    return html`<span class="moments-player moments-player--compact" data-player data-sound="${o.url}">
      <button class="moments-player__play" type="button" aria-label="${label}"></button>
    </span>`;
  return html`<div
    class="moments-player"
    data-player
    data-sound="${o.url}"
    ${o.level === undefined ? "" : html`data-level="${o.level.toFixed(2)}"`}
  >
    <button class="moments-player__play" type="button" aria-label="${label}"></button>
    <span class="moments-player__title">${o.title}</span>${wave(o.id)}<span
      class="moments-player__length canccu-num"
      >${(o.length_ms / 1000).toFixed(1)} s</span
    >${o.extra ?? ""}
  </div>`;
}
