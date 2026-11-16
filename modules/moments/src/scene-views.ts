/**
 * Studio → Moments → Scenes (design sheet 12) and the scene on On air (mockup 14): server-drawn,
 * `packages/ui` classes. The band chart is SVG, as the pages' CSP allows no inline style.
 */
import type { Html } from "@canccu/ui";
import { html, notice } from "@canccu/ui";
import { PREFIX, formKey } from "./page-kit.js";
import { conditionText } from "./scene-eval.js";
import type { DayBands } from "./scene-eval.js";
import { HERO_FEATURES, MOODS, MOTIONS, PRESETS, crewMinutes } from "./scenes.js";
import type { Condition, Scene } from "./scenes.js";

export interface ZoneSceneView {
  zone_key: string;
  scene_key: string | null;
  since: string;
  why: string;
}
export interface CrewView {
  scene_key: string;
  zones: string[];
  until: string;
}

const MOTION_TEXT: Record<string, string> = {
  calmer: "a step calmer",
  livelier: "a step livelier",
};
const MOOD_TEXT: Record<string, string> = {
  build_up: "build-up",
  doors: "doors",
  peak: "peak",
  wind_down: "wind-down",
  quiet_hours: "quiet hours",
};
/** The built-in layouts (contracts/screen.md); a theme's own may be typed in. */
const LAYOUTS = ["pulse", "dashboard", "hero", "split", "ambient"];

export const whenText = (s: Scene): string =>
  s.when.length === 0 ? "Always" : s.when.map(conditionText).join(", or ");

export function thenText(s: Scene): string {
  const t = s.then;
  const parts = [
    t.motion === null ? null : (MOTION_TEXT[t.motion] ?? t.motion),
    ...Object.entries(t.layouts).map(([z, l]) => `${l} in ${z}`),
    t.stage_mood === null ? null : `stage: ${MOOD_TEXT[t.stage_mood]}`,
    t.palette === null ? null : "own palette",
    t.sound === null ? null : t.sound ? "sound on" : "sound off",
    t.quiet ? "quiet mode" : null,
    t.hero_off.length === 0 ? null : `no ${t.hero_off.join(", ").replace(/_/g, " ")}`,
  ].filter((p) => p !== null);
  return parts.length === 0 ? "Keeps the look as it is" : parts.join(" · ");
}

const clock = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    Date.parse(iso),
  );

/** The scenes' crew buttons: "Peak now" for one that is off, "End Peak" for the one pressed. */
export function crewButtons(scenes: readonly Scene[], crew: CrewView | null, from: string): Html {
  const buttons = scenes
    .filter((s) => crewMinutes(s) !== null)
    .map((s) => {
      const on = crew?.scene_key === s.key;
      return html`<form method="post" action="${PREFIX}scenes/${s.key}/take">
        ${formKey()}<input type="hidden" name="from" value="${from}" />
        <button
          class="canccu-button ${on ? "canccu-button--secondary" : "canccu-button--primary"} canccu-button--block"
          type="submit"
        >
          ${on ? `End ${s.name}` : `${s.name} now`}
        </button>
      </form>`;
    });
  return html`<div class="moments-crew__buttons">${buttons}</div>`;
}

/** Each zone's scene for On air: what holds, since when and why. */
export function onAirScenes(
  zones: readonly ZoneSceneView[],
  scenes: readonly Scene[],
  timeZone: string,
): Html {
  if (zones.length === 0) return html``;
  const name = (key: string | null) =>
    key === null ? "None (the day's phase)" : (scenes.find((s) => s.key === key)?.name ?? key);
  return html`<ul class="moments-scenes-now">
    ${zones.map(
      (z) =>
        html`<li>
          <span class="canccu-badge canccu-badge--plain">${z.zone_key}</span>
          <strong>Scene: ${name(z.scene_key)}</strong>
          <span class="canccu-small canccu-muted"
            >since ${clock(z.since, timeZone)} · ${z.why}</span
          >
        </li>`,
    )}
  </ul>`;
}

function bandChart(days: readonly DayBands[], scenes: readonly Scene[], zone: string): Html {
  const index = (key: string) => scenes.findIndex((s) => s.key === key) % 6;
  const minutes = (clockText: string) =>
    Number(clockText.slice(0, 2)) * 60 + Number(clockText.slice(3, 5));
  const rows = days.map(
    (d) =>
      html`<div class="moments-bands__row">
        <span class="canccu-small">${d.date}</span>
        <svg
          class="moments-bands__bar"
          viewBox="0 0 1440 20"
          preserveAspectRatio="none"
          role="img"
          aria-label="${d.bands.map((b) => `${b.from}–${b.to} ${b.scene}`).join(", ")}"
        >
          ${d.bands.map(
            (b) =>
              html`<rect
                class="moments-band moments-band--${index(b.scene)}"
                x="${minutes(b.from)}"
                y="0"
                width="${minutes(b.to) - minutes(b.from)}"
                height="20"
                ><title>
                  ${b.from}–${b.to}: ${scenes.find((s) => s.key === b.scene)?.name ?? b.scene}
                </title></rect
              >`,
          )}
        </svg>
      </div>`,
  );
  const legend = scenes.map(
    (s, i) =>
      html`<span class="moments-legend"
        ><svg viewBox="0 0 10 10" aria-hidden="true">
          <rect class="moments-band moments-band--${i % 6}" width="10" height="10" /></svg
        >${s.name}</span
      >`,
  );
  return html`<section class="canccu-card">
    <h2 class="canccu-card__title">The event at a glance</h2>
    <p class="canccu-small canccu-muted">
      What the time and run-of-show conditions alone will do in ${zone || "every zone"}, each day.
      People, games, check-ins and the crew can bring a scene forward.
    </p>
    <div class="moments-bands">
      <div class="moments-bands__axis canccu-small canccu-muted">
        <span></span
        ><span class="moments-bands__hours"
          ><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></span
        >
      </div>
      ${rows.length === 0 ? html`<p class="canccu-muted">No days to show.</p>` : rows}
    </div>
    <p class="canccu-cluster canccu-small">${legend}</p>
  </section>`;
}

function listView(scenes: readonly Scene[], revision: number, canWrite: boolean): Html {
  const post = (path: string, fields: Record<string, string>, label: string, aria: string) =>
    html`<form method="post" action="${PREFIX}scenes/${path}">
      ${Object.entries(fields).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}" />`)}
      <input type="hidden" name="revision" value="${revision}" />
      <button
        class="canccu-button canccu-button--ghost canccu-button--sm"
        type="submit"
        aria-label="${aria}"
      >
        ${label}
      </button>
    </form>`;
  const rows = scenes.map(
    (s, i) =>
      html`<li class="moments-scene">
        <div>
          <p class="moments-item__title">${s.name}</p>
          <p class="canccu-small">${whenText(s)}</p>
          <p class="canccu-small canccu-muted">${thenText(s)}</p>
        </div>
        ${
          canWrite
            ? html`<div class="canccu-cluster">
                ${i > 0 ? post("move", { key: s.key, by: "-1" }, "▲", `Move ${s.name} up`) : ""}
                ${i < scenes.length - 1 ? post("move", { key: s.key, by: "1" }, "▼", `Move ${s.name} down`) : ""}
                <a
                  class="canccu-button canccu-button--ghost canccu-button--sm"
                  href="${PREFIX}scenes?edit=${s.key}"
                  >Edit</a
                >
                ${post("delete", { key: s.key }, "Delete", `Delete ${s.name}`)}
              </div>`
            : ""
        }
      </li>`,
  );
  const add = canWrite
    ? html`<form class="canccu-cluster" method="post" action="${PREFIX}scenes/add">
        <input type="hidden" name="revision" value="${revision}" />
        <label class="canccu-field__label" for="preset">New scene from</label>
        <select class="canccu-input" id="preset" name="preset">
          ${PRESETS.map((p) => html`<option value="${p.key}">${p.name}</option>`)}
        </select>
        <button class="canccu-button canccu-button--secondary" type="submit">New scene</button>
      </form>`
    : "";
  return html`<section class="canccu-card">
    <h2 class="canccu-card__title">Scenes</h2>
    <p class="canccu-small canccu-muted">
      The first scene in the list whose conditions hold is on; any one condition is enough.
    </p>
    <ol class="moments-scenes">
      ${rows}
    </ol>
    ${add}
  </section>`;
}

const conditionOf = <T extends Condition["type"]>(s: Scene, type: T) =>
  s.when.find((c): c is Extract<Condition, { type: T }> => c.type === type);

function field(id: string, label: string, input: Html): Html {
  return html`<div class="canccu-field">
    <label class="canccu-field__label" for="${id}">${label}</label>${input}
  </div>`;
}
const text = (name: string, value: string | number | undefined, o: { type?: string } = {}) =>
  html`<input
    class="canccu-input"
    id="${name}"
    name="${name}"
    type="${o.type ?? "text"}"
    value="${value ?? ""}"
  />`;
const select = (name: string, value: string, options: readonly [string, string][]) =>
  html`<select class="canccu-input" id="${name}" name="${name}">
    ${options.map(([v, l]) => html`<option value="${v}" ${v === value ? "selected" : ""}>${l}</option>`)}
  </select>`;
const check = (name: string, value: string, checked: boolean, label: string) =>
  html`<div class="canccu-field canccu-field--check">
    <input
      class="canccu-check"
      type="checkbox"
      id="${name}-${value}"
      name="${name}"
      value="${value}"
      ${checked ? "checked" : ""}
    />
    <label class="canccu-field__label" for="${name}-${value}">${label}</label>
  </div>`;

function editView(s: Scene, zones: readonly string[], revision: number): Html {
  const time = conditionOf(s, "time");
  const agenda = conditionOf(s, "agenda");
  const presence = conditionOf(s, "presence");
  const t = s.then;
  return html`<form
    class="canccu-card canccu-form moments-form"
    method="post"
    action="${PREFIX}scenes/save"
  >
    <h2 class="canccu-card__title">Scene: ${s.name}</h2>
    <input type="hidden" name="key" value="${s.key}" /><input
      type="hidden"
      name="revision"
      value="${revision}"
    />
    ${field("name", "Name", text("name", s.name))}
    <fieldset class="moments-fieldset">
      <legend class="canccu-field__label">Zones (none ticked: every zone)</legend>
      <div class="moments-checks">
        ${zones.map((z) => check("zone", z, s.zones.includes(z), z))}
      </div>
    </fieldset>
    <fieldset class="moments-fieldset">
      <legend class="canccu-field__label">When any of these holds</legend>
      <div class="moments-pair">
        ${field("time_from", "Every day from (HH:MM)", text("time_from", time?.from))}
        ${field("time_to", "until", text("time_to", time?.to))}
      </div>
      <div class="moments-pair">
        ${field("agenda_kinds", "An item of kind runs (comma-separated)", text("agenda_kinds", agenda?.kinds.join(", ")))}
        ${field("agenda_within", "…or starts within (minutes)", text("agenda_within", agenda?.starts_within_minutes, { type: "number" }))}
      </div>
      ${field("checkins_over", "Check-ins an hour over", text("checkins_over", conditionOf(s, "checkins")?.over, { type: "number" }))}
      <div class="moments-pair">
        ${field("online_over", "Online over", text("online_over", presence?.over, { type: "number" }))}
        ${field("online_under", "Online under", text("online_under", presence?.under, { type: "number" }))}
      </div>
      ${check("games", "yes", conditionOf(s, "games") !== undefined, "A game is surging")}
      ${field("crew_minutes", "Crew button, holds for minutes (empty: no button)", text("crew_minutes", conditionOf(s, "crew")?.minutes, { type: "number" }))}
      <p class="canccu-small canccu-muted">
        An outside signal, such as a volume meter, is planned.
      </p>
    </fieldset>
    <fieldset class="moments-fieldset">
      <legend class="canccu-field__label">Then</legend>
      ${field("motion", "Motion", select("motion", t.motion ?? "", [["", "Keep the event's"], ...MOTIONS.map((m): [string, string] => [m, MOTION_TEXT[m] ?? m])]))}
      ${zones.map((z) => field(`layout_${z}`, `Layout in ${z}`, html`<input class="canccu-input" id="layout_${z}" name="layout_${z}" list="moments-layouts" value="${t.layouts[z] ?? ""}" />`))}
      <datalist id="moments-layouts">
        ${LAYOUTS.map((l) => html`<option value="${l}"></option>`)}
      </datalist>
      ${field("stage_mood", "Stage", select("stage_mood", t.stage_mood ?? "", [["", "Follow the day"], ...MOODS.map((m): [string, string] => [m, MOOD_TEXT[m] ?? m])]))}
      ${check("palette_on", "yes", t.palette !== null, "Own palette (the theme stays)")}
      <div class="moments-pair">
        ${field("palette_primary", "Primary", text("palette_primary", t.palette?.primary ?? "#3b82f6", { type: "color" }))}
        ${field("palette_accent", "Accent", text("palette_accent", t.palette?.accent ?? "#f59e0b", { type: "color" }))}
      </div>
      ${field(
        "sound",
        "Sound",
        select("sound", t.sound === null ? "" : t.sound ? "on" : "off", [
          ["", "Keep the zone's"],
          ["on", "On"],
          ["off", "Off"],
        ]),
      )}
      ${check("quiet", "yes", t.quiet, "Quiet mode: calm at most, urgent sounds only")}
      <p class="canccu-field__label">The hero skips</p>
      <div class="moments-checks">
        ${HERO_FEATURES.map((f) => check("hero_off", f, t.hero_off.includes(f), f.replace(/_/g, " ")))}
      </div>
    </fieldset>
    <div class="moments-pair">
      ${field("hold_minutes", "Hold for at least (minutes)", text("hold_minutes", s.hold_minutes, { type: "number" }))}
      ${field("blend_seconds", "Blend over (seconds)", text("blend_seconds", s.blend_seconds, { type: "number" }))}
    </div>
    <p class="canccu-small canccu-muted">
      The hold keeps scenes from flipping back and forth; colours and mood blend in slowly.
    </p>
    <div class="canccu-cluster">
      <button class="canccu-button canccu-button--primary" type="submit">Save scene</button>
      <a class="canccu-button canccu-button--ghost" href="${PREFIX}scenes">Cancel</a>
    </div>
  </form>`;
}

export function scenesPageView(o: {
  scenes: readonly Scene[];
  revision: number;
  zones: readonly string[];
  now: readonly ZoneSceneView[];
  crew: CrewView | null;
  days: readonly DayBands[];
  chartZone: string;
  edit: Scene | null;
  canWrite: boolean;
  canTake: boolean;
  timeZone: string;
  done?: string | undefined;
  error?: string | undefined;
}): Html {
  const flash = o.error
    ? notice({ kind: "down", title: "Not saved", text: o.error })
    : o.done
      ? notice({ kind: "ok", title: o.done })
      : "";
  const side = html`<section class="canccu-card moments-crew">
    <h2 class="canccu-card__title">Right now</h2>
    ${onAirScenes(o.now, o.scenes, o.timeZone)}
    ${o.canTake ? crewButtons(o.scenes, o.crew, "scenes") : ""}
    ${
      o.canWrite
        ? html`<form method="post" action="${PREFIX}scenes/reset">
            <input type="hidden" name="revision" value="${o.revision}" />
            <button class="canccu-button canccu-button--ghost canccu-button--block" type="submit">
              Reset to default
            </button>
          </form>`
        : ""
    }
  </section>`;
  const zonePicker = html`<nav class="moments-scopes" aria-label="Zone of the chart">
    ${o.zones.map((z) => html`<a class="canccu-badge${z === o.chartZone ? " canccu-badge--primary" : " canccu-badge--plain"}" href="${PREFIX}scenes?zone=${encodeURIComponent(z)}">${z}</a>`)}
  </nav>`;
  return html`${flash}
    <div class="moments-onair">
      <div class="moments-scenes-page">
        ${zonePicker} ${bandChart(o.days, o.scenes, o.chartZone)}
        ${o.edit === null ? "" : editView(o.edit, o.zones, o.revision)}
        ${listView(o.scenes, o.revision, o.canWrite)}
      </div>
      ${side}
    </div>`;
}
