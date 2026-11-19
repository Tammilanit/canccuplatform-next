/**
 * The round (step 4 polish sheet 05, markers 4 to 6; sheet 06, 4 and 5): the steps as a strip of
 * small pictures in the hero's look with their seconds, the repeat as a bracket, and the chosen
 * step's form beside it, its fields two to a row with the label above. Every step's form is in
 * the page (the others hidden), so a save keeps every step; static/story-builder.js opens one
 * from the strip and moves steps, and without it a step opens through the address and moves with
 * its Move buttons, which save.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import { PREFIX } from "../page-kit.js";
import type { Described, StepCard } from "./describe.js";
import { STEP_TEMPLATES } from "./form.js";
import { TRANSITIONS } from "./model.js";
import type { Story, StoryStep } from "./model.js";
import {
  change,
  chip,
  field,
  secs,
  segmented,
  select,
  str,
  textInput,
  toggle,
} from "./builder-fields.js";

export const TEMPLATE_NAMES: Record<string, string> = {
  title_card: "Title",
  sting: "Sting",
  countdown: "Countdown",
  qr: "QR code",
  video: "Video",
  match_called: "Match called",
  winner_card: "Winner",
  bracket: "Bracket",
  photo: "Photo",
  agenda_now: "Agenda now",
};
const nameOf = (t: string): string => TEMPLATE_NAMES[t] ?? t;

/** The step as a small picture of itself, drawn in the hero's look. */
function picture(s: StoryStep, card: StepCard, sample: (t: string) => string): Html {
  const c = s.content;
  const text = (v: unknown) => sample(str(v));
  const warn = card.under_floor ? " moments-step__pic--short" : "";
  switch (s.template) {
    case "sting":
      return html`<span class="moments-step__pic moments-step__pic--sting${warn}"
        ><span class="moments-step__big">${text(c.text)}</span></span
      >`;
    case "countdown":
      return html`<span class="moments-step__pic moments-step__pic--countdown${warn}"
        ><span class="moments-step__small">${text(c.label)}</span
        ><span class="moments-step__count">05:00</span></span
      >`;
    case "qr":
      return html`<span class="moments-step__pic${warn}"
        ><span class="moments-step__qr" aria-hidden="true"></span
        ><span class="moments-step__small"
          >${text((c.qr as Record<string, unknown> | undefined)?.label ?? c.label)}</span
        ></span
      >`;
    case "video":
      return html`<span class="moments-step__pic moments-step__pic--video${warn}"
        ><span class="moments-step__big" aria-hidden="true">▶</span></span
      >`;
    case "title_card":
      return html`<span class="moments-step__pic${warn}"
        ><span class="moments-step__title">${text(c.title)}</span
        ><span class="moments-step__small">${text(c.subtitle)}</span></span
      >`;
    default:
      return html`<span class="moments-step__pic${warn}"
        ><span class="moments-step__title">${nameOf(s.template)}</span></span
      >`;
  }
}

function strip(o: Builder): Html {
  const { story: st, d } = o;
  const rep = st.round.repeat;
  const href = (i: number) => `${PREFIX}storyboards?edit=${st.key}&step=${String(i)}#step-form`;
  const items = st.round.steps.map((s, i) => {
    const card = d.cards[i] as StepCard;
    const marks = `${s.cue === null ? "" : " ♪"}${s.on_the_dot ? " ●" : ""}`;
    const inRepeat = rep !== null && i >= rep.from && i <= rep.to;
    const cls = [
      inRepeat ? " moments-steps__item--repeat" : "",
      rep?.from === i ? " moments-steps__item--repeat-first" : "",
      rep?.to === i ? " moments-steps__item--repeat-last" : "",
    ].join("");
    return html`<li
      class="moments-steps__item${cls}"
      ${rep?.from === i ? html`data-times="${String(rep.times)}"` : ""}
    >
      <a
        class="moments-step"
        href="${href(i)}"
        data-step="${String(i)}"
        data-name="${nameOf(s.template)}"
        ${i === o.step ? html`aria-current="step"` : ""}
        aria-keyshortcuts="ArrowUp ArrowDown"
        >${picture(s, card, o.sample)}<span class="moments-step__line"
          ><span class="moments-step__name">${String(i + 1)} · ${nameOf(s.template)}</span
          ><span class="moments-step__secs">${secs(card.played_ms)}${marks}</span></span
        ></a
      >
    </li>`;
  });
  return html`<fieldset
    class="canccu-card moments-builder__strip"
    data-tab="round"
    ${o.canWrite ? "" : "disabled"}
  >
    <legend class="moments-visually-hidden">The round</legend>
    <h2 class="canccu-card__title">The round</h2>
    <p class="canccu-small canccu-muted">
      ${secs(d.compiled.length_ms)} · ${String(d.compiled.steps.length)} steps
    </p>
    <ol
      class="moments-steps"
      data-steps
      ${rep === null ? "" : html`data-repeat-from="${String(rep.from)}" data-repeat-to="${String(rep.to)}" data-repeat-times="${String(rep.times)}"`}
    >
      ${items}
    </ol>
    ${change("add_step", "yes", "+ Add a step", "moments-step-add")}
    <p class="canccu-small canccu-muted">
      Drag to reorder, or the arrow keys on a
      step.${
        rep === null
          ? ""
          : ` Steps ${String(rep.from + 1)}–${String(rep.to + 1)} repeat ×${String(rep.times)}${d.compiled.repeat_dropped ? " (dropped: over the limit)" : ""}.`
      }
    </p>
    <input
      type="hidden"
      name="order"
      value="${st.round.steps.map((_, i) => String(i)).join(",")}"
    />
    <input type="hidden" name="step" value="${String(o.step)}" />
    ${chip(
      rep === null
        ? "Add a repeat"
        : `Repeat ${String(rep.from + 1)}–${String(rep.to + 1)} ×${String(rep.times)}`,
      html`<div class="moments-grid">
        ${field("repeat_from", "From step", textInput("repeat_from", "repeat_from", rep === null ? "" : rep.from + 1, { number: true }))}
        ${field("repeat_to", "To step", textInput("repeat_to", "repeat_to", rep === null ? "" : rep.to + 1, { number: true }))}
        ${field("repeat_times", "Times (2–5)", textInput("repeat_times", "repeat_times", rep?.times, { number: true }))}
        ${field("hold_seconds", "Long hold (s, up to 180)", textInput("hold_seconds", "hold_seconds", st.round.hold_seconds, { number: true }))}
      </div>`,
      { add: rep === null },
    )}
    <div class="moments-field moments-size">
      <span class="canccu-field__label">Size on screen, every step</span>
      ${segmented(
        "full_screen",
        [
          ["no", "Hero"],
          ["yes", "Full screen"],
        ],
        st.full_screen ? "yes" : "no",
        { label: "Size on screen" },
      )}
    </div>
  </fieldset>`;
}

function stepForm(s: StoryStep, i: number, o: Builder): Html {
  const p = (k: string) => `s${String(i)}_${k}`;
  const c = s.content;
  const card = o.d.cards[i] as StepCard;
  const qr = (c.qr ?? {}) as { path?: string; label?: string };
  const title = str(c.title) || str(c.text) || str(c.label);
  const sub = str(c.subtitle) || str(c.ends_text);
  const newCue = `story.${o.story.key}.${String(i + 1)}`;
  const filled = [title, sub].filter((x) => x.includes("{")).map(o.sample);
  const input = (k: string, v: string | number | null | undefined, mono = false) =>
    textInput(p(k), p(k), v, { mono });
  const floor =
    card.floor_seconds > 0 || card.under_floor
      ? `At least ${String(Math.max(card.floor_seconds, Math.round(card.played_ms / 1000)))} s for ${String(card.words)} words${card.under_floor ? `: it plays ${secs(card.played_ms)}` : ""}`
      : `Plays ${secs(card.played_ms)}`;
  return html`<fieldset
    class="moments-stepform"
    data-step-form="${String(i)}"
    ${i === o.step ? "" : "hidden"}
  >
    <legend class="moments-visually-hidden">Step ${String(i + 1)}</legend>
    <div class="moments-stepform__head">
      <h2 class="canccu-card__title" data-step-head>
        Step ${String(i + 1)} · ${nameOf(s.template)}
      </h2>
      <span class="moments-stepform__moves">
        ${change("move", `${String(i)}:-1`, "Move earlier", "canccu-button canccu-button--ghost canccu-button--sm")}
        ${change("move", `${String(i)}:1`, "Move later", "canccu-button canccu-button--ghost canccu-button--sm")}
      </span>
      ${change(p("remove"), "yes", "Remove step")}
    </div>
    <div class="canccu-field moments-field--wide">
      <span class="canccu-field__label">Shows</span>
      <div class="canccu-chips" role="radiogroup" aria-label="Shows">
        ${STEP_TEMPLATES.map(
          (t) =>
            html`<label class="canccu-chip"
              ><input
                type="radio"
                name="${p("template")}"
                value="${t}"
                ${t === s.template ? "checked" : ""}
              />${nameOf(t)}</label
            >`,
        )}
      </div>
    </div>
    <div class="moments-grid">
      ${field(p("title"), html`<span data-for="title_card">Title</span><span data-for="sting">Text</span><span data-for="countdown">Above the count</span>`, input("title", title, true), { name: "title", for: "title_card sting countdown" })}
      ${field(p("subtitle"), html`<span data-for="title_card">Under the title</span><span data-for="countdown">Under the count</span>`, input("subtitle", sub, true), { name: "subtitle", for: "title_card countdown" })}
      ${field(p("qr_path"), "QR path on the event's hostname", textInput(p("qr_path"), p("qr_path"), qr.path, { placeholder: "/notify/", mono: true }), { name: "qr_path", for: "title_card qr" })}
      ${field(p("qr_label"), "QR label", input("qr_label", qr.label, true), { name: "qr_label", for: "title_card qr" })}
      ${field(p("asset"), "Video or YouTube asset", input("asset", str(c.asset_id)), { name: "asset", for: "video", hint: "From Screen → Content." })}
      ${field(p("video_seconds"), "Its length in seconds", input("video_seconds", str(c.duration_seconds)), { name: "video_seconds", for: "video", hint: "YouTube only: a file's is read." })}
    </div>
    ${filled.length === 0 ? "" : html`<p class="canccu-small canccu-muted moments-fills">Fills with: ${filled.join(" · ")}</p>`}
    <div class="moments-grid">
      <div class="canccu-field moments-field" data-field="seconds">
        <span class="moments-field__top"
          ><label class="canccu-field__label" for="${p("seconds")}">Seconds</label
          ><output data-seconds-out for="${p("seconds")}"
            >${String(s.duration_seconds)} s</output
          ></span
        >
        <input
          class="moments-range"
          id="${p("seconds")}"
          name="${p("seconds")}"
          type="range"
          min="1"
          max="60"
          step="1"
          value="${String(s.duration_seconds)}"
          data-seconds
        />
        <p class="canccu-field__hint${card.under_floor ? " moments-warn" : ""}">${floor}</p>
      </div>
      ${field(
        p("transition"),
        "Transition in",
        select(
          p("transition"),
          p("transition"),
          TRANSITIONS.map((t) => [t, `${t.charAt(0).toUpperCase()}${t.slice(1)}`] as const),
          s.transition,
        ),
        { name: "transition" },
      )}
      ${field(
        p("cue"),
        "Cue at its start",
        select(p("cue"), p("cue"), [["", "None"], ...o.cues.map((x) => [x, x] as const)], s.cue),
        {
          name: "cue",
          hint: html`<a href="${PREFIX}cues/new?name=${encodeURIComponent(newCue)}"
            >+ New cue (${newCue})</a
          >`,
        },
      )}
      <div class="moments-field moments-field--switches" data-field="marks">
        ${toggle("dot", String(i), s.on_the_dot, "Lands on the dot", { hint: "Ends exactly at T" })}
        ${toggle("message", String(i), s.message, "The message step", { hint: "Holds at least the card time" })}
      </div>
    </div>
    ${
      o.placeholders.length === 0
        ? ""
        : html`<div class="moments-placeholders">
            <span class="canccu-field__label">Placeholders</span>
            <div class="canccu-chips">
              ${o.placeholders.map((x) => html`<button class="canccu-chip moments-mono" type="button" data-insert="{${x}}">{${x}}</button>`)}
            </div>
          </div>`
    }
  </fieldset>`;
}

export interface Builder {
  story: Story;
  d: Described;
  cues: string[];
  step: number;
  canWrite: boolean;
  placeholders: string[];
  sample: (text: string) => string;
}

/** The strip and, beside it, the chosen step's form (every step's form is in the page). */
export function roundColumns(o: Builder): Html {
  return html`${strip(o)}
    <fieldset
      class="canccu-card moments-builder__step"
      id="step-form"
      data-tab="round"
      ${o.canWrite ? "" : "disabled"}
    >
      <legend class="moments-visually-hidden">The chosen step</legend>
      ${o.story.round.steps.map((s, i) => stepForm(s, i, o))}
    </fieldset>`;
}
