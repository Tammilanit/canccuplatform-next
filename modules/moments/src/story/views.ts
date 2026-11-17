/**
 * Studio → Moments → Storyboards (SU5): the list, the builder (mockup 18) and the crew's part on
 * On air and the phone (SU2): fire, Stop loop, Skip to finale. Server-drawn with `packages/ui`
 * classes; the strip and the timeline are SVG, as the pages' CSP allows no inline style.
 */
import type { Html } from "@canccu/ui";
import { html, notice } from "@canccu/ui";
import { PREFIX, formKey } from "../page-kit.js";
import { conditionsText, roundsText, sharedPlaceholders, triggerText } from "./describe.js";
import type { Described } from "./describe.js";
import { freeVariablesOf } from "./model.js";
import type { Story } from "./model.js";
import type { StorySettings } from "./store.js";
import { storyEditor } from "./editor.js";

export interface RunView {
  id: string;
  story_key: string;
  name: string;
  status: string;
  test: boolean;
  zones: string[];
  round: { number: number; finale: boolean; until: string } | null;
  has_finale: boolean;
  started_at: string;
}
export interface ItemChoice {
  id: string;
  title: string;
  starts_at: string;
}

const secs = (ms: number): string => `${String(Math.round(ms / 100) / 10)} s`;

export const flash = (done?: string, error?: string): Html | string =>
  error
    ? notice({ kind: "down", title: "Not done", text: error })
    : done
      ? notice({ kind: "ok", title: done })
      : "";

/** The round as a strip of cards, each as wide as it plays; the repeat drawn as a bracket. */
function strip(st: Story, d: Described): Html {
  const total = Math.max(
    1,
    d.cards.reduce((a, c) => a + Math.max(c.played_ms, 2000), 0),
  );
  let x = 0;
  const W = 640;
  const cards = d.cards.map((c) => {
    const w = (Math.max(c.played_ms, 2000) / total) * W;
    const at = x;
    x += w;
    return html`<g>
      <rect
        x="${String(at + 1)}"
        y="22"
        width="${String(Math.max(4, w - 2))}"
        height="58"
        rx="6"
        class="moments-strip__card${c.message ? " moments-strip__card--message" : ""}"
      ></rect>
      <text x="${String(at + 6)}" y="40" class="moments-strip__label"
        >${String(c.index + 1)} · ${c.template}${c.on_the_dot ? " ●" : ""}</text
      >
      <text x="${String(at + 6)}" y="56" class="moments-strip__meta"
        >${secs(c.played_ms)} ·
        ${c.transition}${c.floor_seconds > 0 ? ` · floor ${String(c.floor_seconds)} s` : ""}</text
      >
      <text x="${String(at + 6)}" y="72" class="moments-strip__meta"
        >${c.cue === null ? "♪ none" : `♪ ${c.cue}`}</text
      >
    </g>`;
  });
  const rep = st.round.repeat;
  let bracket: Html | string = "";
  if (rep !== null) {
    const before = d.cards
      .slice(0, rep.from)
      .reduce((a, c) => a + (Math.max(c.played_ms, 2000) / total) * W, 0);
    const width = d.cards
      .slice(rep.from, rep.to + 1)
      .reduce((a, c) => a + (Math.max(c.played_ms, 2000) / total) * W, 0);
    bracket = html`<path
        d="M${String(before + 2)} 18 V8 H${String(before + width - 2)} V18"
        class="moments-strip__bracket"
      ></path>
      <text x="${String(before + 6)}" y="6" class="moments-strip__meta"
        >${`repeat ×${String(rep.times)}${d.compiled.repeat_dropped ? " (dropped: over the limit)" : ""}`}</text
      >`;
  }
  return html`<svg
    class="moments-strip"
    viewBox="0 -8 ${String(W)} 92"
    role="img"
    aria-label="The round's steps"
  >
    ${bracket}${cards}
  </svg>`;
}

/** The rounds on a small timeline from the first to T, the finale at T. */
function timeline(st: Story, d: Described): Html {
  const xs = [...d.rounds_at, 0];
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const W = 640;
  const pos = (m: number) => 20 + ((m - lo) / Math.max(1, hi - lo)) * (W - 40);
  const marks = d.rounds_at.map(
    (m, i) =>
      html`<g>
        <rect
          x="${String(pos(m) - 4)}"
          y="14"
          width="8"
          height="22"
          rx="2"
          class="moments-timeline__round${d.sounding[i] === true ? " moments-timeline__round--sound" : ""}"
        ></rect>
        <text x="${String(pos(m))}" y="52" text-anchor="middle" class="moments-strip__meta"
          >${m === 0 ? "T" : `T${m > 0 ? "+" : "−"}${String(Math.round(Math.abs(m) * 10) / 10)}`}</text
        >
      </g>`,
  );
  const finale =
    st.finale === null
      ? ""
      : html`<circle
          cx="${String(pos(0))}"
          cy="25"
          r="6"
          class="moments-timeline__finale"
        ></circle>`;
  return html`<svg
    class="moments-timeline"
    viewBox="0 0 ${String(W)} 60"
    role="img"
    aria-label="The rounds: ${roundsText(st)}"
  >
    <line x1="10" y1="25" x2="${String(W - 10)}" y2="25" class="moments-timeline__axis"></line>
    ${marks}${finale}
  </svg>`;
}

/** Fire (with its item and free variables), and each live loop's Stop loop and Skip to finale. */
export function crewStories(o: {
  stories: Story[];
  runs: RunView[];
  items: ItemChoice[];
  canTake: boolean;
  back: string;
}): Html {
  if (!o.canTake) return html``;
  const takes = o.stories.filter((s) => s.enabled && s.triggers.some((t) => t.kind === "take"));
  const live = o.runs.filter((r) => r.status === "live");
  const fire = takes.map((s) => {
    const needsItem = s.triggers.some((t) => t.kind === "item");
    const vars = freeVariablesOf(s);
    return html`<form
      class="canccu-stack moments-story-fire"
      method="post"
      action="${PREFIX}storyboards/${s.key}/fire"
    >
      ${formKey()}<input type="hidden" name="back" value="${o.back}" />
      ${
        needsItem
          ? html`<label class="canccu-field__label" for="item-${s.key}">Item</label>
              <select class="canccu-input" id="item-${s.key}" name="item_id">
                ${o.items.map((i) => html`<option value="${i.id}">${i.title} · ${i.starts_at.slice(11, 16)}</option>`)}
              </select>`
          : ""
      }
      ${vars.map((v) => html`<label class="canccu-field__label" for="${s.key}-${v}">{${v}}</label><input class="canccu-input" id="${s.key}-${v}" name="var_${v}" maxlength="120" />`)}
      <button class="canccu-button canccu-button--secondary canccu-button--block" type="submit">
        Fire ${s.name}
      </button>
    </form>`;
  });
  const running = live.map(
    (r) =>
      html`<li class="moments-list__row">
        <span
          ><strong>${r.name}</strong>${r.test ? " (test)" : ""} ·
          ${r.round === null ? "between rounds" : r.round.finale ? "finale" : `round ${String(r.round.number)}`}</span
        >
        <span class="canccu-cluster">
          <form method="post" action="${PREFIX}storyboards/runs/${r.id}/stop">
            ${formKey()}<input type="hidden" name="back" value="${o.back}" /><button
              class="canccu-button canccu-button--ghost canccu-button--sm"
              type="submit"
            >
              Stop loop
            </button>
          </form>
          ${r.has_finale ? html`<form method="post" action="${PREFIX}storyboards/runs/${r.id}/finale">${formKey()}<input type="hidden" name="back" value="${o.back}" /><button class="canccu-button canccu-button--ghost canccu-button--sm" type="submit">Skip to finale</button></form>` : ""}
        </span>
      </li>`,
  );
  return html`<section class="canccu-card moments-crew">
    <h2 class="canccu-card__title">Storyboards</h2>
    ${
      running.length === 0
        ? html`<p class="canccu-small canccu-muted">No loop is running.</p>`
        : html`<ul class="moments-list">
            ${running}
          </ul>`
    }
    ${fire}
  </section>`;
}

export function storyListView(o: {
  stories: Story[];
  runs: RunView[];
  items: ItemChoice[];
  canWrite: boolean;
  canTake: boolean;
  revision: number;
  done?: string | undefined;
  error?: string | undefined;
}): Html {
  const rows = o.stories.map(
    (s) =>
      html`<li class="moments-list__row">
        <span class="canccu-stack">
          <a href="${PREFIX}storyboards?edit=${s.key}"><strong>${s.name}</strong></a>
          <span class="canccu-small canccu-muted"
            >${s.triggers.map(triggerText).join(" · or · ")}</span
          >
          <span class="canccu-small canccu-muted">${roundsText(s)}</span>
        </span>
        <span class="canccu-cluster">
          <span class="canccu-badge ${s.enabled ? "canccu-badge--ok" : "canccu-badge--plain"}"
            >${s.enabled ? "On" : "Off"}</span
          >
          ${o.canWrite ? html`<form method="post" action="${PREFIX}storyboards/${s.key}/toggle">${formKey()}<input type="hidden" name="revision" value="${String(o.revision)}" /><button class="canccu-button canccu-button--ghost canccu-button--sm" type="submit">${s.enabled ? "Turn off" : "Turn on"}</button></form>` : ""}
          ${o.canWrite && s.preset !== null ? html`<form method="post" action="${PREFIX}storyboards/${s.key}/reset">${formKey()}<input type="hidden" name="revision" value="${String(o.revision)}" /><button class="canccu-button canccu-button--ghost canccu-button--sm" type="submit">Reset to default</button></form>` : ""}
        </span>
      </li>`,
  );
  return html`${flash(o.done, o.error)}
    <div class="moments-onair">
      <section class="canccu-card moments-zones">
        <h2 class="canccu-card__title">Storyboards</h2>
        <p class="canccu-small canccu-muted">
          Sequences for the peaks: each plays its rounds through the arbiter, the sound gates and
          the history. Presets are copied on first use; reset brings back this version's.
        </p>
        <ul class="moments-list">
          ${rows}
        </ul>
        ${o.canWrite ? html`<form method="post" action="${PREFIX}storyboards/new">${formKey()}<input type="hidden" name="revision" value="${String(o.revision)}" /><button class="canccu-button canccu-button--secondary" type="submit">New story</button></form>` : ""}
      </section>
      <div class="moments-side">
        ${crewStories({ stories: o.stories, runs: o.runs, items: o.items, canTake: o.canTake, back: "storyboards" })}
      </div>
    </div>`;
}

export function builderView(o: {
  story: Story;
  d: Described;
  settings: StorySettings;
  zones: string[];
  cues: string[];
  revision: number;
  canWrite: boolean;
  canTake: boolean;
  /** All stories' share of each zone's last 10 minutes. */
  airtime: { zone: string; share: number }[];
  done?: string | undefined;
  error?: string | undefined;
}): Html {
  const { story: st, d } = o;
  const zone = o.zones[0];
  const steps = d.compiled.steps
    .filter((p) => !p.video)
    .map((p) => ({
      template: p.template,
      content: p.content,
      duration_ms: Math.max(500, Math.min(60_000, p.duration_ms)),
    }));
  const preview =
    zone === undefined
      ? html`<p class="canccu-small canccu-muted">The preview needs a zone.</p>`
      : html`<div class="moments-preview__frame">
            <iframe
              src="/screen/zones/${encodeURIComponent(zone)}"
              title="Preview of ${zone}"
              data-story-preview
              data-zone="${zone}"
              data-steps="${JSON.stringify(steps)}"
              data-regions="${JSON.stringify(st.full_screen ? ["full"] : ["hero", "rail"])}"
              data-rounds="${JSON.stringify(d.rounds_at)}"
              data-length="${String(d.compiled.length_ms)}"
            ></iframe>
          </div>
          <label class="canccu-field__label" for="scrub"
            >Scrub one round · ${secs(d.compiled.length_ms)}</label
          >
          <input
            class="canccu-input"
            id="scrub"
            type="range"
            min="0"
            max="${String(d.compiled.length_ms)}"
            step="500"
            value="0"
            data-story-scrub
          />
          <button
            class="canccu-button canccu-button--ghost canccu-button--sm"
            type="button"
            data-story-loop
          >
            Preview whole loop (gaps shortened)
          </button>
          <p class="canccu-small canccu-muted" data-preview-note>
            The real player, with the event's theme, on ${zone}; placeholders show their sample
            text.
          </p>`;
  const test = !o.canTake
    ? ""
    : html`<form class="canccu-cluster" method="post" action="${PREFIX}storyboards/${st.key}/test">
        ${formKey()}
        <label class="canccu-field__label" for="test-zone">Test-fire one round on</label>
        <select class="canccu-input" id="test-zone" name="zone">
          ${o.zones.map((z) => html`<option value="${z}">${z}</option>`)}
        </select>
        <label class="canccu-field canccu-field--check"
          ><input class="canccu-check" type="checkbox" name="sound" value="yes" /> with sound</label
        >
        <button class="canccu-button canccu-button--secondary" type="submit">Test-fire</button>
      </form>`;
  const meters = html`<ul class="moments-list canccu-small">
    <li>
      This story:
      ${d.loop_share === null ? "one round" : `${String(Math.round(d.loop_share * 100))} % of its loop`}
      · cap for all stories ${String(o.settings.airtime_percent)} % of any 10 min
    </li>
    ${o.airtime.map((a) => html`<li>All stories on ${a.zone}: ${String(Math.round(a.share * 100))} % of the last 10 min</li>`)}
    <li>Sounds per run, per zone: ${String(d.sounds_per_run)} of the story cap 6 (2 a round)</li>
    <li>Patience a round: ${String(d.patience_s)} s, then skip</li>
  </ul>`;
  return html`${flash(o.done, o.error)}
    <p><a href="${PREFIX}storyboards">← All storyboards</a></p>
    <div class="moments-onair">
      <div class="moments-zones canccu-stack">
        <section class="canccu-card">
          <h2 class="canccu-card__title">Storyboard: ${st.name}</h2>
          <p class="canccu-small canccu-muted">
            ${st.preset === null ? "The event's own" : `Preset · copied from the platform`} · class
            Storyboard (65) · ${st.full_screen ? "full screen" : "hero → rail"} ·
            ${st.enabled ? "On for this event" : "Off"}
          </p>
          <h3>Plays when (any one)</h3>
          <ul class="moments-list">
            ${st.triggers.map((t) => html`<li>${triggerText(t)}</li>`)}
          </ul>
          <h3>Only if (all)</h3>
          <ul class="moments-list canccu-small">
            ${conditionsText(st).map((c) => html`<li>${c}</li>`)}
          </ul>
          <p class="canccu-small canccu-muted">
            Placeholders every trigger fills:
            ${sharedPlaceholders(st)
              .map((p) => `{${p}}`)
              .join(" ")}
          </p>
        </section>
        <section class="canccu-card">
          <h2 class="canccu-card__title">The round</h2>
          <p class="canccu-small canccu-muted">
            ${secs(d.compiled.length_ms)} · ${String(d.compiled.steps.length)} steps after the
            repeat · at most ${st.round.hold_seconds === null ? "120" : "180"} s · busy venue
            ×${String(o.settings.factor)}
          </p>
          ${strip(st, d)}
          <h3>Rounds</h3>
          <p>${roundsText(st)} · sound on ${st.sound.replace(/_/g, " ")} round</p>
          ${timeline(st, d)}
        </section>
        <section class="canccu-card">
          <h2 class="canccu-card__title">Preview on the virtual screen</h2>
          ${preview} ${test}
        </section>
        ${o.canWrite ? storyEditor({ story: st, zones: o.zones, cues: o.cues, revision: o.revision }) : ""}
      </div>
      <div class="moments-side">
        <section class="canccu-card">
          <h2 class="canccu-card__title">Before you save</h2>
          ${meters}
          <h3>Checks</h3>
          <ul class="moments-list canccu-small">
            ${d.checks.map((c) => html`<li>${c.ok ? "✓" : "!"} ${c.text}</li>`)}
          </ul>
        </section>
      </div>
    </div>`;
}
