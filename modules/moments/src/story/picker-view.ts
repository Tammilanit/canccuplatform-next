/**
 * Studio → Moments → Storyboards (docs/design/grids/05-storyboards.svg, amendment 3): the Fire band
 * above the catalogue, then one card grid per group: the event's own, "every event" (on by
 * default) and "some venues" (off). A card says what triggers the story, its rounds and sound, its
 * status and the rule it replaces; On or Off and Turn on or off, with Duplicate and Reset to
 * default in its ⋯ menu so the card fits 18rem. A preset the event has not copied yet shows the
 * platform's and is copied when turned on. Built-ins by catalogue number, the event's own A to Z.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import { PREFIX, formKey } from "../page-kit.js";
import type { Story } from "./model.js";
import { roundsShort, soundShort, statusOf, triggerShort } from "./picker.js";
import type { PickerCtx } from "./picker.js";
import { PRESETS, PRESET_INFO } from "./presets.js";
import type { PresetGroup } from "./presets.js";
import type { Timing } from "./timing.js";
import { crewStories, flash } from "./views.js";
import type { ItemChoice, RunView } from "./views.js";

interface Row {
  story: Story;
  copied: boolean;
}

const post = (action: string, revision: number, label: string, kind = "ghost") =>
  html`<form method="post" action="${PREFIX}storyboards/${action}">
    ${formKey()}<input type="hidden" name="revision" value="${String(revision)}" /><button
      class="canccu-button canccu-button--${kind} canccu-button--sm"
      type="submit"
    >
      ${label}
    </button>
  </form>`;

/** One action of a card's ⋯ menu. */
const item = (action: string, revision: number, label: string) =>
  html`<form method="post" action="${PREFIX}storyboards/${action}">
    ${formKey()}<input type="hidden" name="revision" value="${String(revision)}" /><button
      class="moments-menu__item"
      type="submit"
    >
      ${label}
    </button>
  </form>`;

function card(r: Row, ctx: PickerCtx, canWrite: boolean, revision: number): Html {
  const s = r.story;
  const number = s.preset === null ? null : PRESET_INFO[s.preset]?.number;
  const status = statusOf(s, ctx);
  const menu = [
    canWrite ? item(`${s.key}/duplicate`, revision, "Duplicate") : "",
    canWrite && r.copied && s.preset !== null
      ? item(`${s.key}/reset`, revision, "Reset to default")
      : "",
  ].filter((x) => x !== "");
  return html`<li class="canccu-card moments-preset">
    <div class="moments-preset__head">
      ${r.copied ? html`<a href="${PREFIX}storyboards?edit=${s.key}"><strong>${s.name}</strong></a>` : html`<strong>${s.name}</strong>`}
      <span class="canccu-badge ${s.enabled ? "canccu-badge--ok" : "canccu-badge--plain"}"
        >${s.enabled ? "On" : "Off"}</span
      >
    </div>
    <span class="canccu-table__sub"
      >${number === undefined || number === null ? "" : `${String(number)} · `}${s.triggers.map(triggerShort).join("; ")}</span
    >
    <span class="canccu-small">${roundsShort(s)} · ♪ ${soundShort(s)}</span>
    ${status.map((x) => html`<span class="canccu-table__sub">${x}</span>`)}
    ${r.copied ? "" : html`<span class="canccu-table__sub">not in this event yet: turning it on copies it</span>`}
    ${
      canWrite
        ? html`<div class="canccu-card__foot moments-preset__foot">
            ${post(`${s.key}/toggle`, revision, s.enabled ? "Turn off" : "Turn on")}
            ${
              menu.length === 0
                ? ""
                : html`<details class="moments-menu">
                    <summary class="moments-menu__more" aria-label="More for ${s.name}">⋯</summary>
                    <div class="moments-menu__list">${menu}</div>
                  </details>`
            }
          </div>`
        : ""
    }
  </li>`;
}

/** One group: its heading, then its cards, or one dashed line with what to do. */
function group(
  title: string,
  text: string,
  rows: Row[],
  empty: string,
  o: { ctx: PickerCtx; canWrite: boolean; revision: number },
): Html {
  return html`<section class="moments-group">
    <h2 class="moments-group__title">${title}</h2>
    <p class="canccu-small canccu-muted">${text}</p>
    ${
      rows.length === 0
        ? html`<p class="moments-group__none canccu-small">${empty}</p>`
        : html`<ul class="canccu-grid moments-presets">
            ${rows.map((r) => card(r, o.ctx, o.canWrite, o.revision))}
          </ul>`
    }
  </section>`;
}

const GROUPS: { group: PresetGroup; title: string; text: string }[] = [
  {
    group: "every",
    title: "Every event",
    text: "On by default; idle where the trigger never comes.",
  },
  {
    group: "venues",
    title: "Some venues",
    text: "Off by default: turn on what fits the venue.",
  },
];

export function pickerView(o: {
  stories: Story[];
  runs: RunView[];
  items: ItemChoice[];
  now: number;
  ctx: PickerCtx;
  settings: Timing;
  canWrite: boolean;
  canTake: boolean;
  revision: number;
  done?: string | undefined;
  error?: string | undefined;
}): Html {
  const byKey = new Map(o.stories.map((s) => [s.key, s]));
  const presetRows = (g: PresetGroup): Row[] =>
    PRESETS.filter((p) => PRESET_INFO[p.key]?.group === g)
      .sort((a, b) => (PRESET_INFO[a.key]?.number ?? 0) - (PRESET_INFO[b.key]?.number ?? 0))
      .map((p) => {
        const own = byKey.get(p.key);
        // Not copied means not running, whatever the platform default says; "Turn on" copies it in.
        return { story: own ?? { ...p, enabled: false }, copied: own !== undefined };
      });
  const own: Row[] = o.stories
    .filter((s) => s.preset === null || PRESET_INFO[s.key] === undefined)
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .map((story) => ({ story, copied: true }));
  const actions = o.canWrite
    ? html`<div class="canccu-cluster">
        ${post("new", o.revision, "New storyboard", "secondary")}
        ${post("reset", o.revision, "Reset all to default")}
      </div>`
    : "";
  const fire = crewStories({
    stories: o.stories,
    runs: o.runs,
    items: o.items,
    now: o.now,
    canTake: o.canTake,
    back: "storyboards",
    timeZone: o.ctx.event.time_zone,
    settings: o.settings,
    title: "Fire a storyboard",
  });
  const opts = { ctx: o.ctx, canWrite: o.canWrite, revision: o.revision };
  return html`${flash(o.done, o.error)} ${fire} ${actions}
    <p class="canccu-small canccu-muted">
      Built-ins are copied into the event on first use; a later platform version never changes them.
      A name opens the builder. Duplicate a built-in to edit a copy, or edit it and reset it to
      default later. Turning on a preset that overlaps a built-in rule turns the rule off for this
      event, and back.
    </p>
    ${group(
      "Your storyboards",
      "The event's own stories and copies.",
      own,
      o.canWrite
        ? "No storyboards of your own yet. Duplicate a built-in, or start with New storyboard."
        : "No storyboards of the event's own yet.",
      opts,
    )}
    ${GROUPS.map((g) => group(g.title, g.text, presetRows(g.group), "None in this group.", opts))}`;
}
