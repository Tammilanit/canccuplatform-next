/**
 * The builder's rounds (step 4 polish sheet 05, marker 3): one switch for set times or every few
 * minutes (a loop), Until and Sound on the same line, the rounds as blocks on a time axis to the
 * finale, and each round, the loop's pace, the other ends and the finale as chips. The axis is
 * SVG in percentages, so it is as wide as the card and its labels keep their size; the pages' CSP
 * allows no inline style.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import { roundsText } from "./describe.js";
import type { Described } from "./describe.js";
import { DOMAIN_TYPES, lastRoundKnown } from "./model.js";
import type { Story } from "./model.js";
import {
  chip,
  field,
  minutes,
  secs,
  segmented,
  select,
  str,
  textInput,
  toggle,
} from "./builder-fields.js";

const pc = (n: number): string => `${String(Math.round(n * 100) / 100)}%`;

function timeline(st: Story, d: Described): Html {
  const at = d.rounds_at;
  const lo = Math.min(0, ...at);
  const hi = Math.max(0, ...at.map((m) => m + d.compiled.length_ms / 60_000));
  const span = Math.max(1, hi - lo);
  const x = (m: number) => 3 + ((m - lo) / span) * 90;
  const width = Math.max(1.6, (d.compiled.length_ms / 60_000 / span) * 90);
  // The widest gap between rounds says what plays there, when it has room for the words.
  const gaps = at
    .slice(1)
    .map((m, i) => ({ from: (at[i] ?? 0) + d.compiled.length_ms / 60_000, to: m }));
  const wide = gaps.sort((a, b) => b.to - b.from - (a.to - a.from))[0];
  const between =
    wide !== undefined && ((wide.to - wide.from) / span) * 90 > 30
      ? html`<text
          x="${pc((x(wide.from) + x(wide.to)) / 2)}"
          y="30"
          text-anchor="middle"
          class="moments-timeline__note"
          >the Pulse and other moments between rounds</text
        >`
      : "";
  const ticks = Array.from(
    { length: 13 },
    (_, i) =>
      html`<line
        x1="${pc(3 + (i * (x(hi) - 3)) / 12)}"
        x2="${pc(3 + (i * (x(hi) - 3)) / 12)}"
        y1="${i % 4 === 0 ? "46" : "48"}"
        y2="${i % 4 === 0 ? "56" : "54"}"
        class="moments-timeline__tick"
      ></line>`,
  );
  const rounds = at.map(
    (m, i) =>
      html`<g>
        <rect
          x="${pc(x(m))}"
          y="22"
          width="${pc(width)}"
          height="20"
          rx="4"
          class="moments-timeline__round${d.sounding[i] === true ? " moments-timeline__round--sound" : ""}"
          ><title>
            Round ${String(i + 1)} at ${minutes(m)}${d.sounding[i] === true ? ", with sound" : ""}
          </title></rect
        >
        <text x="${pc(x(m))}" y="72" class="moments-timeline__label">${minutes(m)}</text>
      </g>`,
  );
  const finale =
    st.finale === null
      ? ""
      : html`<rect
            x="${pc(Math.min(x(hi), 97) - 1)}"
            y="20"
            width="${pc(3)}"
            height="24"
            rx="5"
            class="moments-timeline__finale"
          ></rect>
          <text
            x="${pc(Math.min(x(hi), 97) + 0.5)}"
            y="14"
            text-anchor="middle"
            class="moments-timeline__finale-label"
            >Finale</text
          >`;
  // Beside the last round's label, T would touch it on a phone; the finale marks T there.
  const near = at.length > 0 && x(0) - x(Math.max(...at)) < 8;
  const t = html`<text
    x="${pc(x(0))}"
    y="72"
    text-anchor="middle"
    class="moments-timeline__label moments-timeline__label--t${near ? " moments-timeline__label--near" : ""}"
    >T</text
  >`;
  return html`<svg
    class="moments-timeline"
    width="100%"
    height="80"
    role="img"
    aria-label="The rounds: ${roundsText(st)}"
  >
    <line x1="3%" x2="${pc(x(hi))}" y1="51" y2="51" class="moments-timeline__axis"></line>
    ${ticks}${between}${rounds}${finale}${at.includes(0) ? "" : t}
  </svg>`;
}

const UNTIL: readonly (readonly [string, string])[] = [
  ["", "no event"],
  ["item_starts", "the item starts"],
  ["item_ends", "the item ends"],
  ["next_item_starts", "the next item starts"],
  ...Object.keys(DOMAIN_TYPES).map((x) => [`domain:${x}`, x] as const),
];

function untilOf(st: Story): string {
  const u = st.end.until_event;
  return u === null ? "" : u.kind === "domain" ? `domain:${u.type}` : u.kind;
}

function roundChips(st: Story): Html {
  const r = st.rounds;
  const offsets = r.mode === "offsets" ? r.offsets_minutes : [];
  const offset = (m: number | null, i: number) =>
    field(
      `offsets-${String(i)}`,
      "Minutes from T",
      textInput(`offsets-${String(i)}`, "offsets", m === null ? "" : m, {
        number: true,
        placeholder: "-5",
      }),
      {
        hint: m === null ? "Saved with the rest." : "Empty it to drop the round.",
      },
    );
  const every = r.mode === "every" ? r : { every_minutes: 10, from_minutes: 0 };
  return html`<span class="moments-rounds__offsets">
      ${offsets.map((m, i) => chip(`${minutes(m)}${m === 0 ? "" : " min"}`, offset(m, i)))}
      ${chip("Add a round", offset(null, offsets.length), { add: true })}
    </span>
    <span class="moments-rounds__every">
      ${chip(
        `Every ${String(every.every_minutes)} min`,
        field(
          "every",
          "Every (min)",
          textInput("every", "every", r.mode === "every" ? every.every_minutes : "", {
            number: true,
          }),
        ),
      )}
      ${chip(
        `From ${minutes(every.from_minutes)}${every.from_minutes === 0 ? "" : " min"}`,
        field(
          "every_from",
          "From (min of T)",
          textInput("every_from", "every_from", r.mode === "every" ? every.from_minutes : "", {
            number: true,
          }),
        ),
      )}
    </span>`;
}

function endsChip(st: Story): Html {
  const e = st.end;
  const face = [
    e.rounds === null ? null : `${String(e.rounds)} round${e.rounds === 1 ? "" : "s"}`,
    e.for_minutes === null ? null : `for ${String(e.for_minutes)} min`,
    e.until_clock === null ? null : `until ${e.until_clock}`,
    e.crew ? "the crew may stop it" : null,
  ].filter((x) => x !== null);
  return chip(
    `Ends: ${face.length === 0 ? "set an end" : face.join(" · ")}`,
    html`<div class="moments-grid">
        ${field("end_rounds", "Rounds (1–20)", textInput("end_rounds", "end_rounds", e.rounds, { number: true }))}
        ${field("end_for", "For (min)", textInput("end_for", "end_for", e.for_minutes, { number: true }))}
        ${field("end_clock", "Until (HH:MM)", textInput("end_clock", "end_clock", e.until_clock))}
      </div>
      ${toggle("end_crew", "yes", e.crew, "The crew may stop the loop")}`,
  );
}

function finaleChip(st: Story, cues: string[]): Html {
  const f0 = st.finale?.[0];
  const face =
    f0 === undefined
      ? "Add a finale"
      : `Finale: ${str(f0.content.title) || f0.template} · ${String(f0.duration_seconds)} s${f0.cue === null ? "" : ` · ♪ ${f0.cue}`}`;
  return chip(
    face,
    html`<div class="moments-grid">
      ${field("finale_title", "Finale title (empty: none)", textInput("finale_title", "finale_title", f0 === undefined ? "" : str(f0.content.title), { mono: true }))}
      ${field("finale_seconds", "Seconds (at least 8)", textInput("finale_seconds", "finale_seconds", f0?.duration_seconds, { number: true }))}
      ${field("finale_cue", "Cue", select("finale_cue", "finale_cue", [["", "None"], ...cues.map((c) => [c, c] as const)], f0?.cue))}
    </div>`,
    { add: f0 === undefined },
  );
}

export function roundsCard(st: Story, d: Described, cues: string[]): Html {
  const sounds: (readonly [string, string])[] = [
    ["first", "the first round"],
    ["every", "every round"],
    ...(lastRoundKnown(st)
      ? ([
          ["last", "the last round"],
          ["first_and_last", "first and last round"],
        ] as const)
      : []),
  ];
  return html`<section class="canccu-card moments-builder__rounds" data-tab="overview">
    <div class="moments-rounds__line">
      <h2 class="canccu-card__title">Rounds</h2>
      ${segmented(
        "rounds_mode",
        [
          ["offsets", "At set times"],
          ["every", "Every few minutes"],
        ],
        st.rounds.mode,
        { label: "Rounds" },
      )}
      <label class="moments-inline">
        <span>Until</span>${select("end_event", "end_event", UNTIL, untilOf(st))}
      </label>
      <label class="moments-inline">
        <span>Sound</span>${select(
          "sound",
          "sound",
          sounds.map(
            ([v, l]) => [v, v === "first_and_last" ? "the first and last round" : l] as const,
          ),
          st.sound,
        )}
      </label>
    </div>
    ${timeline(st, d)}
    <div class="moments-rounds__chips">
      ${roundChips(st)} ${endsChip(st)}
      <span class="moments-rounds__finale">${finaleChip(st, cues)}</span>
    </div>
    <p class="canccu-small canccu-muted">
      Each round lasts ${secs(d.compiled.length_ms)}; a round that sounds is filled.
    </p>
  </section>`;
}
