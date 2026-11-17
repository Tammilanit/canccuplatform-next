/**
 * Studio → Moments → Storyboards: the preset picker (mockup 21) over the event's own stories.
 * Every built-in in two groups, "every event" (on by default) and "some venues" (off), each with
 * what triggers it, its rounds and sound, its status and the rule it replaces; on or off, duplicate
 * to edit, reset to default. A preset the event has not copied yet shows the platform's and is
 * copied when turned on. On a phone the rounds and sound columns step aside.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import { PREFIX, formKey } from "../page-kit.js";
import type { Story } from "./model.js";
import { roundsShort, soundShort, statusOf, triggerShort } from "./picker.js";
import type { PickerCtx } from "./picker.js";
import { PRESETS, PRESET_INFO } from "./presets.js";
import type { PresetGroup } from "./presets.js";
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

function row(r: Row, ctx: PickerCtx, canWrite: boolean, revision: number): Html {
  const s = r.story;
  const number = s.preset === null ? null : PRESET_INFO[s.preset]?.number;
  const status = statusOf(s, ctx);
  return html`<tr>
    <td>
      ${r.copied ? html`<a href="${PREFIX}storyboards?edit=${s.key}"><strong>${s.name}</strong></a>` : html`<strong>${s.name}</strong>`}
      <span class="canccu-table__sub"
        >${number === undefined || number === null ? "" : `${String(number)} · `}${s.triggers.map(triggerShort).join("; ")}</span
      >
      ${r.copied ? "" : html`<span class="canccu-table__sub">not in this event yet: turning it on copies it</span>`}
    </td>
    <td class="canccu-hide-phone">${roundsShort(s)}</td>
    <td class="canccu-hide-phone">${soundShort(s)}</td>
    <td>${status.map((x) => html`<span class="canccu-table__sub">${x}</span>`)}</td>
    <td>
      <span class="canccu-cluster">
        <span class="canccu-badge ${s.enabled ? "canccu-badge--ok" : "canccu-badge--plain"}"
          >${s.enabled ? "On" : "Off"}</span
        >
        ${canWrite ? post(`${s.key}/toggle`, revision, s.enabled ? "Turn off" : "Turn on") : ""}
        ${canWrite ? post(`${s.key}/duplicate`, revision, "Duplicate") : ""}
        ${canWrite && r.copied && s.preset !== null ? post(`${s.key}/reset`, revision, "Reset to default") : ""}
      </span>
    </td>
  </tr>`;
}

function table(rows: Row[], ctx: PickerCtx, canWrite: boolean, revision: number): Html {
  return html`<table class="canccu-table">
    <thead>
      <tr>
        <th>Preset</th>
        <th class="canccu-hide-phone">Rounds, end</th>
        <th class="canccu-hide-phone">Sound</th>
        <th>Status</th>
        <th>On</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((r) => row(r, ctx, canWrite, revision))}
    </tbody>
  </table>`;
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
  ctx: PickerCtx;
  canWrite: boolean;
  canTake: boolean;
  revision: number;
  done?: string | undefined;
  error?: string | undefined;
}): Html {
  const byKey = new Map(o.stories.map((s) => [s.key, s]));
  const presetRows = (g: PresetGroup): Row[] =>
    PRESETS.filter((p) => PRESET_INFO[p.key]?.group === g).map((p) => {
      const own = byKey.get(p.key);
      return { story: own ?? p, copied: own !== undefined };
    });
  const own: Row[] = o.stories
    .filter((s) => s.preset === null || PRESET_INFO[s.key] === undefined)
    .map((story) => ({ story, copied: true }));
  const section = (title: string, text: string, rows: Row[]) =>
    html`<section class="canccu-card">
      <h2 class="canccu-card__title">${title}</h2>
      <p class="canccu-small canccu-muted">${text}</p>
      ${table(rows, o.ctx, o.canWrite, o.revision)}
    </section>`;
  const actions = o.canWrite
    ? html`<div class="canccu-cluster">
        ${post("new", o.revision, "New storyboard", "secondary")}
        ${post("reset", o.revision, "Reset all to default")}
      </div>`
    : "";
  return html`${flash(o.done, o.error)}
    <div class="moments-onair">
      <div class="canccu-stack">
        <p class="canccu-small canccu-muted">
          Built-ins are copied into the event on first use; a later platform version never changes
          them. A name opens the builder. Duplicate a built-in to edit a copy, or edit it and reset
          it to default later. Turning on a preset that overlaps a built-in rule turns the rule off
          for this event, and back.
        </p>
        ${actions} ${GROUPS.map((g) => section(g.title, g.text, presetRows(g.group)))}
        ${own.length === 0 ? "" : section("Your storyboards", "The event's own stories and copies.", own)}
      </div>
      <div class="moments-side">
        ${crewStories({ stories: o.stories, runs: o.runs, items: o.items, canTake: o.canTake, back: "storyboards" })}
      </div>
    </div>`;
}
