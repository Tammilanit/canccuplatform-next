/**
 * The sound desk's Limits and categories (#626, the step 4 polish sheets 03 and 04): the budget per
 * zone with sliders and a stepper, each zone's use as meters and what is missing in words with
 * where to fix it, and the six categories as rows of controls. Interrupts and the calm rule are
 * the fixed sound rules (contracts/moments.md, The model), so their two-way switches show the rule
 * and change nothing.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import { PREFIX } from "../page-kit.js";
import { CALM, CATEGORIES } from "./catalog.js";
import type { Category, SoundSettings } from "./catalog.js";
import { meter, slider, stepper, toggle } from "./controls.js";
import { categoryName, listed } from "./names.js";
import type { DeskZone } from "./views.js";

const DEVICES = "/admin/screen/devices";

/** What the zone lets through now, in words, with its energy. */
function letsThrough(z: DeskZone): string {
  if (z.lets_through === null) return "Unknown: Screen did not answer";
  const energy = z.energy === "quiet" ? "quiet scene" : (z.energy ?? "");
  const which =
    z.lets_through.length === CATEGORIES.length
      ? "Every category"
      : z.lets_through.length === 1
        ? "Urgent only"
        : (() => {
            const s = listed(z.lets_through.map((c) => categoryName(c).toLowerCase()));
            return s.charAt(0).toUpperCase() + s.slice(1);
          })();
  return `${which} (${energy})`;
}

function soundScreen(z: DeskZone): Html {
  const s = z.sound_screen;
  if (s === null)
    return html`<span class="canccu-badge canccu-badge--late">None</span> ·
      <a class="canccu-small" href="${DEVICES}">Set one in Devices ›</a>`;
  const flag = !s.online
    ? html` <span class="canccu-badge canccu-badge--down">offline</span>`
    : s.audio_unlocked === false
      ? html` <span class="canccu-badge canccu-badge--late">audio locked</span>`
      : "";
  return html`${s.name}${flag}`;
}

/** A fixed rule as a two-way switch that shows which way it is. */
const fixed = (label: string, [a, b]: [string, string], first: boolean): Html =>
  html`<span class="moments-segments moments-segments--fixed" role="group" aria-label="${label}, fixed">
    <span class="moments-segment" aria-current="${first ? "true" : "false"}">${a}</span
    ><span class="moments-segment" aria-current="${first ? "false" : "true"}">${b}</span>
  </span>`;

function categoryRow(c: Category, s: SoundSettings, canWrite: boolean): Html {
  const name = categoryName(c);
  return html`<li class="moments-category">
    <span class="moments-category__name"><span class="moments-tag moments-tag--${c}">${name}</span></span>
    <span class="moments-category__level"
      >${slider({ id: `level-${c}`, name: `${c}.level`, label: `${name} level`, min: 0, max: 100, step: 5, value: s.categories[c].level, format: "pct", enabled: canWrite, hideLabel: true })}</span
    >
    ${fixed(`${name} when another plays`, ["Interrupts", "Waits"], c === "urgent")}
    ${fixed(`${name} at calm`, ["Plays", "Silent"], CALM.has(c))}
    <span class="moments-category__on"
      >${toggle({ name: `${c}.enabled`, on: s.categories[c].enabled, label: `${name} on`, enabled: canWrite })}</span
    >
  </li>`;
}

export function limitsView(o: {
  settings: SoundSettings & { revision: number };
  zones: DeskZone[];
  canWrite: boolean;
}): Html {
  const s = o.settings;
  const w = o.canWrite;
  const budget = html`<section class="canccu-card">
    <h2 class="canccu-card__title">Budget per zone</h2>
    <p class="canccu-small canccu-muted">
      Urgent always passes and still counts. One sound at a time per zone.
    </p>
    <div class="moments-limits">
      ${slider({ id: "hourly-budget", name: "hourly_budget", label: "Sounds an hour", min: 0, max: Math.max(60, s.hourly_budget), value: s.hourly_budget, format: "count", enabled: w })}
      ${slider({ id: "per-minute", name: "per_minute", label: "Sounds a minute", min: 1, max: Math.max(10, s.per_minute), value: s.per_minute, format: "count", enabled: w })}
      <div class="moments-slider">
        <label class="moments-slider__label" for="per-source">Seconds between sounds of one source</label>
        ${stepper({ id: "per-source", name: "per_source_seconds", label: "Seconds between sounds of one source", value: s.per_source_seconds, min: 0, max: 3600, by: 5, unit: "s", less: "Five seconds less", more: "Five seconds more", enabled: w })}
      </div>
    </div>
    <div class="moments-zonehead" aria-hidden="true">
      <span>Zone</span><span>This hour</span><span>This minute</span><span>Lets through now</span><span>Sound screen</span>
    </div>
    <ul class="moments-zones">
      ${o.zones.map(
        (z) =>
          html`<li class="moments-zone">
            <b class="moments-zone__name">${z.zone_key}</b>
            <span class="moments-zone__hour"
              >${meter(z.hour, s.hourly_budget, `${z.zone_key} this hour`)}
              <span class="canccu-small">${z.hour} of ${s.hourly_budget} this hour</span></span
            >
            <span class="moments-zone__minute"
              >${meter(z.minute, s.per_minute, `${z.zone_key} this minute`)}
              <span class="canccu-small">${z.minute} of ${s.per_minute} this minute</span></span
            >
            <span class="moments-zone__lets canccu-small">${letsThrough(z)}</span>
            <span class="moments-zone__screen canccu-small">${soundScreen(z)}</span>
          </li>`,
      )}
    </ul>
  </section>`;
  const categories = html`<section class="canccu-card">
    <h2 class="canccu-card__title">Categories</h2>
    <p class="canccu-small canccu-muted">
      Six, fixed, in this order: a higher one waits for none below it. Events add cues, never
      categories. Only urgent interrupts, and only urgent, result and attention play at calm.
    </p>
    <div class="moments-categoryhead" aria-hidden="true">
      <span>Category</span><span>Level</span><span>When another plays</span><span>At calm</span><span>On</span>
    </div>
    <ul class="moments-categories">
      ${CATEGORIES.map((c) => categoryRow(c, s, w))}
    </ul>
  </section>`;
  return html`<form class="moments-limitsform" method="post" action="${PREFIX}cues/settings">
    <input type="hidden" name="revision" value="${s.revision}" />
    ${s.enabled ? html`<input type="hidden" name="enabled" value="on" />` : ""}
    <input type="hidden" name="volume" value="${s.volume}" />
    ${budget}${categories}
    ${w ? html`<div class="canccu-savebar"><span class="canccu-savebar__text">Changes apply to every zone once saved.</span><button class="canccu-button canccu-button--primary" type="submit">Save</button></div>` : ""}
  </form>`;
}
