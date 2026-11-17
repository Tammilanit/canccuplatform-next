/**
 * The builder's edit form (mockup 18): the triggers, the conditions, the steps with their
 * duration, transition, cue ("+ New cue" opens the sound desk with a `story.<story>.<step>` cue),
 * message and on-the-dot marks, the repeat, the rounds, the ends, the finale and which rounds
 * sound. form.ts reads it back; the API checks it.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import { PREFIX, formKey } from "../page-kit.js";
import { ADD_TRIGGERS, STEP_TEMPLATES } from "./form.js";
import { DOMAIN_TYPES, ENERGIES, TRANSITIONS, lastRoundKnown } from "./model.js";
import type { Story, StoryStep, Trigger } from "./model.js";

const str = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
const opt = (value: string, label: string, current: string | null | undefined) =>
  html`<option value="${value}" ${value === (current ?? "") ? "selected" : ""}>${label}</option>`;
const field = (id: string, label: string, input: Html) =>
  html`<div class="canccu-field">
    <label class="canccu-field__label" for="${id}">${label}</label>${input}
  </div>`;
const text = (
  name: string,
  value: string | number | null | undefined,
  o: { label: string; placeholder?: string },
) =>
  field(
    name,
    o.label,
    html`<input
      class="canccu-input"
      id="${name}"
      name="${name}"
      value="${value === null || value === undefined ? "" : String(value)}"
      placeholder="${o.placeholder ?? ""}"
    />`,
  );
const check = (name: string, on: boolean, label: string) =>
  html`<label class="canccu-field canccu-field--check"
    ><input
      class="canccu-check"
      type="checkbox"
      name="${name}"
      value="yes"
      ${on ? "checked" : ""}
    />
    ${label}</label
  >`;

function triggerFields(t: Trigger, i: number): Html {
  const p = (k: string) => `t${String(i)}_${k}`;
  let body: Html | string = "";
  if (t.kind === "item")
    body = html`${text(p("kinds"), t.kinds.join(", "), { label: "Item kinds" })}${text(p("item_id"), t.item_id, { label: "Or one item (id)" })}
    ${field(
      p("anchor"),
      "At its",
      html`<select class="canccu-input" id="${p("anchor")}" name="${p("anchor")}">
        ${opt("start", "start", t.anchor)}${opt("end", "end", t.anchor)}
      </select>`,
    )}`;
  if (t.kind === "domain")
    body = html`${field(
      p("type"),
      "Event",
      html`<select class="canccu-input" id="${p("type")}" name="${p("type")}">
        ${Object.keys(DOMAIN_TYPES).map((x) => opt(x, x, t.type))}
      </select>`,
    )}${check(p("final"), t.final_only, "Only for a final")}`;
  if (t.kind === "clock")
    body = html`${field(
      p("mode"),
      "Clock",
      html`<select class="canccu-input" id="${p("mode")}" name="${p("mode")}">
        ${["daily", "once", "every", "event_start", "event_end"].map((x) => opt(x, x.replace("_", " "), t.mode))}
      </select>`,
    )}
    ${text(p("at"), t.at, { label: "At (HH:MM, or a date-time once)" })}${text(p("every"), t.every_minutes, { label: "Every (min, 15–240)" })}
    ${text(p("from"), t.from, { label: "From (HH:MM)" })}${text(p("until"), t.until, { label: "Until (HH:MM)" })}`;
  if (t.kind === "scene")
    body = html`${text(p("scene"), t.scene_key, { label: "Scene" })}${field(
      p("change"),
      "When a zone",
      html`<select class="canccu-input" id="${p("change")}" name="${p("change")}">
        ${opt("enters", "enters it", t.change)}${opt("leaves", "leaves it", t.change)}
      </select>`,
    )}`;
  if (t.kind === "milestone")
    body = html`${field(
      p("count"),
      "Count",
      html`<select class="canccu-input" id="${p("count")}" name="${p("count")}">
        ${["online", "checkins", "photos"].map((x) => opt(x, x, t.count))}
      </select>`,
    )}${text(p("value"), t.at, { label: "Reaches (empty: a new peak)" })}`;
  return html`<fieldset class="canccu-card canccu-stack">
    <legend>${t.kind}</legend>
    ${body}${check(p("remove"), false, "Remove this trigger")}
  </fieldset>`;
}

function stepFields(s: StoryStep, i: number, story: Story, cues: string[]): Html {
  const p = (k: string) => `s${String(i)}_${k}`;
  const c = s.content;
  const qr = (c.qr ?? {}) as { path?: string; label?: string };
  const title = str(c.title) || str(c.text) || str(c.label);
  const sub = str(c.subtitle) || str(c.ends_text);
  const newCue = `story.${story.key}.${String(i + 1)}`;
  return html`<fieldset class="canccu-card canccu-stack">
    <legend>Step ${String(i + 1)}</legend>
    ${field(
      p("template"),
      "Shows",
      html`<select class="canccu-input" id="${p("template")}" name="${p("template")}">
        ${STEP_TEMPLATES.map((x) => opt(x, x.replace("_", " "), s.template))}
      </select>`,
    )}
    ${text(p("title"), title, { label: "Title (or sting text, countdown label)", placeholder: "{item.title}" })}
    ${text(p("subtitle"), sub, { label: "Subtitle" })}
    ${text(p("qr_path"), qr.path, { label: "QR path on the event's hostname", placeholder: "/notify/" })}${text(p("qr_label"), qr.label, { label: "QR label" })}
    ${s.template === "video" ? html`${text(p("asset"), str(c.asset_id), { label: "Video or YouTube asset (Screen → Content)" })}${text(p("video_seconds"), str(c.duration_seconds), { label: "Its length in seconds (YouTube only: a file's is read)" })}` : ""}
    ${text(p("seconds"), s.duration_seconds, { label: "Seconds (1–60; stings 1–5)" })}
    ${field(
      p("transition"),
      "Transition",
      html`<select class="canccu-input" id="${p("transition")}" name="${p("transition")}">
        ${TRANSITIONS.map((x) => opt(x, x, s.transition))}
      </select>`,
    )}
    ${field(
      p("cue"),
      "Cue at its start",
      html`<select class="canccu-input" id="${p("cue")}" name="${p("cue")}">
        ${opt("", "none", s.cue)}${cues.map((x) => opt(x, x, s.cue))}
      </select>`,
    )}
    <a class="canccu-small" href="${PREFIX}cues/new?name=${encodeURIComponent(newCue)}"
      >+ New cue (${newCue})</a
    >
    <label class="canccu-field canccu-field--check"
      ><input
        class="canccu-check"
        type="radio"
        name="message"
        value="${String(i)}"
        ${s.message ? "checked" : ""}
      />
      The message step</label
    >
    <label class="canccu-field canccu-field--check"
      ><input
        class="canccu-check"
        type="radio"
        name="dot"
        value="${String(i)}"
        ${s.on_the_dot ? "checked" : ""}
      />
      On the dot</label
    >
    ${check(p("remove"), false, "Remove this step")}
  </fieldset>`;
}

export function storyEditor(o: {
  story: Story;
  zones: string[];
  cues: string[];
  revision: number;
}): Html {
  const st = o.story;
  const k = st.conditions;
  const r = st.rounds;
  const e = st.end;
  const rep = st.round.repeat;
  const until =
    e.until_event === null
      ? ""
      : e.until_event.kind === "domain"
        ? `domain:${e.until_event.type}`
        : e.until_event.kind;
  const f0 = st.finale?.[0];
  return html`<form
    class="canccu-card canccu-stack"
    method="post"
    action="${PREFIX}storyboards/${st.key}/save"
  >
    ${formKey()}<input type="hidden" name="revision" value="${String(o.revision)}" />
    <h2 class="canccu-card__title">Edit</h2>
    ${text("name", st.name, { label: "Name" })}
    <div class="canccu-cluster">
      ${check("enabled", st.enabled, "On for this event")}${check("full_screen", st.full_screen, "Full screen")}
    </div>
    <h3>Plays when (any one)</h3>
    ${st.triggers.map((t, i) => triggerFields(t, i))}
    ${field(
      "add_trigger",
      "+ Add a trigger",
      html`<select class="canccu-input" id="add_trigger" name="add_trigger">
        ${opt("", "—", "")}${ADD_TRIGGERS.map((x) => opt(x, x, ""))}
      </select>`,
    )}
    <h3>Only if (all)</h3>
    <div class="canccu-cluster">
      ${o.zones.map((z) => check("zone", k.zones.includes(z), z))}${check("item_zone", k.item_zone, "The item's zone")}
    </div>
    ${text("scenes", k.scenes.join(", "), { label: "Only in scenes" })}${text("not_scenes", k.not_scenes.join(", "), { label: "Not in scenes" })}
    ${field(
      "energy_min",
      "Energy at least",
      html`<select class="canccu-input" id="energy_min" name="energy_min">
        ${opt("", "any", k.energy_min)}${ENERGIES.map((x) => opt(x, x, k.energy_min))}
      </select>`,
    )}
    ${field(
      "energy_max",
      "Energy at most",
      html`<select class="canccu-input" id="energy_max" name="energy_max">
        ${opt("", "any", k.energy_max)}${ENERGIES.map((x) => opt(x, x, k.energy_max))}
      </select>`,
    )}
    ${text("window_from", k.window?.from, { label: "Between (HH:MM)" })}${text("window_until", k.window?.until, { label: "and (HH:MM)" })}
    ${text("days", k.days.join(", "), { label: "Days (YYYY-MM-DD)" })}
    ${field(
      "once",
      "Once",
      html`<select class="canccu-input" id="once" name="once">
        ${opt("", "no", k.once)}${["event", "day", "source"].map((x) => opt(x, `per ${x}`, k.once))}
      </select>`,
    )}
    ${text("cooldown", k.cooldown_minutes, { label: "Cooldown (min)" })}
    ${field(
      "quiet",
      "In a quiet scene",
      html`<select class="canccu-input" id="quiet" name="quiet">
        ${opt("calm", "play calm and silent", k.quiet)}${opt("skip", "skip", k.quiet)}
      </select>`,
    )}
    ${field(
      "run_mode",
      "Run mode",
      html`<select class="canccu-input" id="run_mode" name="run_mode">
        ${["per_source", "restart", "ignore"].map((x) => opt(x, x.replace("_", " "), st.run_mode))}
      </select>`,
    )}
    <h3>The round</h3>
    ${st.round.steps.map((s, i) => stepFields(s, i, st, o.cues))}
    ${check("add_step", false, "+ step")}
    <div class="canccu-cluster">
      ${text("repeat_from", rep === null ? "" : rep.from + 1, { label: "Repeat from step" })}${text("repeat_to", rep === null ? "" : rep.to + 1, { label: "to step" })}${text("repeat_times", rep?.times, { label: "times (2–5)" })}
    </div>
    ${text("hold_seconds", st.round.hold_seconds, { label: "Long hold: the round lasts (s, up to 180; empty: none)" })}
    <h3>Rounds</h3>
    ${field(
      "rounds_mode",
      "Rounds",
      html`<select class="canccu-input" id="rounds_mode" name="rounds_mode">
        ${opt("offsets", "at offsets from T", r.mode)}${opt("every", "every n minutes", r.mode)}
      </select>`,
    )}
    ${text("offsets", r.mode === "offsets" ? r.offsets_minutes.join(", ") : "", { label: "Offsets (min of T)", placeholder: "-15, -5, -1" })}
    <div class="canccu-cluster">
      ${text("every", r.mode === "every" ? r.every_minutes : "", { label: "Every (min)" })}${text("every_from", r.mode === "every" ? r.from_minutes : "", { label: "from (min of T)" })}
    </div>
    <div class="canccu-cluster">
      ${text("end_rounds", e.rounds, { label: "Rounds (1–20)" })}${text("end_for", e.for_minutes, { label: "For (min)" })}${text("end_clock", e.until_clock, { label: "Until (HH:MM)" })}
    </div>
    ${field(
      "end_event",
      "Until",
      html`<select class="canccu-input" id="end_event" name="end_event">
        ${opt("", "—", until)}${opt("item_starts", "the item starts", until)}${opt("item_ends", "the item ends", until)}${opt("next_item_starts", "the next item starts", until)}${Object.keys(DOMAIN_TYPES).map((x) => opt(`domain:${x}`, x, until))}
      </select>`,
    )}
    ${check("end_crew", e.crew, "The crew may stop the loop")}
    ${text("finale_title", f0 === undefined ? "" : str(f0.content.title), { label: "Finale (empty: none)" })}${text("finale_seconds", f0?.duration_seconds, { label: "Finale seconds (at least 8)" })}
    ${field(
      "finale_cue",
      "Finale cue",
      html`<select class="canccu-input" id="finale_cue" name="finale_cue">
        ${opt("", "none", f0?.cue)}${o.cues.map((x) => opt(x, x, f0?.cue))}
      </select>`,
    )}
    ${field(
      "sound",
      "Sound on",
      html`<select class="canccu-input" id="sound" name="sound">
        ${opt("first", "the first round", st.sound)}${opt("every", "every round", st.sound)}${lastRoundKnown(st) ? html`${opt("last", "the last round", st.sound)}${opt("first_and_last", "the first and last round", st.sound)}` : ""}
      </select>`,
    )}
    <button class="canccu-button canccu-button--primary" type="submit">Save</button>
  </form>`;
}
