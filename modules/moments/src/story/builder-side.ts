/**
 * The builder's right column (step 4 polish sheet 05, markers 7 and 8; sheet 06, 1 and 6): the
 * real player at the size of a card with a scrub bar coloured by step, and the checks before
 * saving: airtime and the sound budget as bars with their caps, each check a sentence with a tick
 * or a warning. Bars are SVG in percentages (the CSP allows no inline style).
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import type { Described } from "./describe.js";
import { RUN_SOUNDS } from "./round.js";
import type { StorySettings } from "./store.js";
import { clock, minutes, segmented, toggle } from "./builder-fields.js";

const pc = (n: number): string =>
  `${String(Math.round(Math.max(0, Math.min(1, n)) * 10_000) / 100)}%`;

/** The scrub bar: one round, each step's part in its own colour. */
function scrubBar(d: Described): Html {
  const total = Math.max(1, d.compiled.length_ms);
  let at = 0;
  const parts = d.compiled.steps.map((p) => {
    const x = at / total;
    at += p.duration_ms;
    return html`<rect
      x="${pc(x)}"
      y="0"
      width="${pc(p.duration_ms / total)}"
      height="10"
      rx="3"
      class="moments-scrub__part moments-scrub__part--${p.template}"
    ></rect>`;
  });
  return html`<svg class="moments-scrub__bar" width="100%" height="10" aria-hidden="true">
    ${parts}
  </svg>`;
}

function preview(o: Side): Html {
  const zone = o.zones[0];
  if (zone === undefined)
    return html`<section class="canccu-card moments-builder__preview" data-tab="preview">
      <h2 class="canccu-card__title">Preview</h2>
      <p class="canccu-small canccu-muted">The preview needs a zone.</p>
    </section>`;
  const { d } = o;
  const first = d.rounds_at[0];
  // The zone chosen here is also the test-fire's; without the right to take there is no test.
  const zoneName = o.canTake ? "zone" : "preview_zone";
  const form = o.canTake ? "story-test" : undefined;
  return html`<section class="canccu-card moments-builder__preview" data-tab="preview" id="preview">
    <div class="moments-builder__cardhead">
      <h2 class="canccu-card__title">Preview · <span data-zone-name>${zone}</span></h2>
      <span class="canccu-small canccu-muted"
        >${first === undefined ? "one round" : `round 1 at ${minutes(first)}`}</span
      >
    </div>
    <div class="moments-preview__frame">
      <iframe
        src="/screen/zones/${encodeURIComponent(zone)}"
        title="Preview of the round on the zone"
        data-story-preview
        data-zone="${zone}"
        data-steps="${JSON.stringify(o.steps)}"
        data-regions="${JSON.stringify(o.fullScreen ? ["full"] : ["hero", "rail"])}"
        data-rounds="${JSON.stringify(d.rounds_at)}"
        data-length="${String(d.compiled.length_ms)}"
      ></iframe>
    </div>
    <div class="moments-scrub">
      ${scrubBar(d)}
      <input
        class="moments-scrub__range"
        id="scrub"
        type="range"
        min="0"
        max="${String(d.compiled.length_ms)}"
        step="500"
        value="0"
        aria-label="Scrub one round"
        data-story-scrub
      />
    </div>
    <p class="moments-scrub__meta canccu-small">
      <span data-scrub-at>0:00 of ${clock(d.compiled.length_ms)}</span
      ><span class="canccu-muted">Drag to scrub</span>
    </p>
    <div class="moments-preview__controls">
      ${
        o.zones.length > 1
          ? segmented(
              zoneName,
              o.zones.map((z) => [z, z] as const),
              zone,
              { label: "Zone", ...(form === undefined ? {} : { form }) },
            )
          : html`<input
              type="hidden"
              name="${zoneName}"
              value="${zone}"
              ${form === undefined ? "" : html`form="${form}"`}
            />`
      }
      ${o.canTake ? toggle("sound", "yes", false, "Test with sound", { form: "story-test" }) : ""}
    </div>
    <div class="canccu-cluster">
      <button
        class="canccu-button canccu-button--secondary canccu-button--sm"
        type="button"
        data-story-play
      >
        ▶ Play round
      </button>
      <button
        class="canccu-button canccu-button--secondary canccu-button--sm"
        type="button"
        data-story-loop
      >
        Whole loop
      </button>
    </div>
    <p class="canccu-small canccu-muted" data-preview-note>
      The real player, with the event's theme; placeholders show sample text. Whole loop shortens
      each gap to 2 s.
    </p>
  </section>`;
}

function meter(label: string, share: number, said: string, cap?: number): Html {
  return html`<div class="moments-meter">
    <span class="canccu-small">${label}</span>
    <svg class="moments-meter__bar" width="100%" height="14" aria-hidden="true">
      <rect x="0" y="3" width="100%" height="8" rx="4" class="moments-meter__track"></rect>
      <rect
        x="0"
        y="3"
        width="${pc(share)}"
        height="8"
        rx="4"
        class="moments-meter__fill${cap !== undefined && share > cap ? " moments-meter__fill--over" : ""}"
      ></rect>
      ${cap === undefined ? "" : html`<line x1="${pc(cap)}" x2="${pc(cap)}" y1="0" y2="14" class="moments-meter__cap"></line>`}
    </svg>
    <span class="canccu-small canccu-muted">${said}</span>
  </div>`;
}

export const checkCount = (d: Described): { ok: number; look: number } => ({
  ok: d.checks.filter((c) => c.ok).length,
  look: d.checks.filter((c) => !c.ok).length,
});

function checks(o: Side): Html {
  const { d } = o;
  const cap = o.settings.airtime_percent / 100;
  const where = o.fullScreen ? "the full screen" : "the hero";
  return html`<section class="canccu-card moments-builder__checks" data-tab="preview" id="checks">
    <h2 class="canccu-card__title">Before you save</h2>
    ${
      d.loop_share === null
        ? html`<p class="canccu-small">Airtime on ${where}: one round, no loop to share.</p>`
        : meter(
            `Airtime on ${where}`,
            d.loop_share,
            `${String(Math.round(d.loop_share * 100))} % of its loop · cap for all stories ${String(o.settings.airtime_percent)} % of any 10 min`,
            cap,
          )
    }
    ${o.airtime.map((a) => html`<p class="canccu-small canccu-muted">All stories on ${a.zone}: ${String(Math.round(a.share * 100))} % of the last 10 min</p>`)}
    ${meter(
      "Sounds per run, per zone",
      d.sounds_per_run / RUN_SOUNDS,
      `${String(d.sounds_per_run)} of ${String(RUN_SOUNDS)} · at most 2 a round`,
    )}
    <p class="canccu-small canccu-muted">Patience a round: ${String(d.patience_s)} s, then skip.</p>
    <ul class="moments-checks">
      ${d.checks.map(
        (c) =>
          html`<li class="moments-checks__item${c.ok ? "" : " moments-checks__item--look"}">
            <span class="moments-checks__mark" aria-label="${c.ok ? "Passes" : "To look at"}"
              >${c.ok ? "✓" : "!"}</span
            ><span>${c.text}</span>
          </li>`,
      )}
    </ul>
  </section>`;
}

export interface Side {
  d: Described;
  zones: string[];
  settings: StorySettings;
  airtime: { zone: string; share: number }[];
  canTake: boolean;
  fullScreen: boolean;
  /** The round's steps as the player takes them, their texts filled with the sample. */
  steps: { template: string; content: Record<string, unknown>; duration_ms: number }[];
}

export function sideColumn(o: Side): Html {
  return html`<div class="moments-builder__side">${preview(o)}${checks(o)}</div>`;
}
