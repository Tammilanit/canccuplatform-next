/**
 * The cue editor (#626, the step 4 polish sheets 02 and 04; book shot O10): two cards on the
 * content grid. Sound holds the category as chips with a line on what it means, the chosen sounds
 * as themed players, the rest of the library as add-chips, the voice line, then level, not again
 * for, catch-up and once per source; Picture, Try it and the default pack sit beside it
 * (editor-side.ts). Save and Cancel sit in a pending row. Every control posts as a plain form;
 * cues/pages.ts turns the slider's stop and the minutes into the API's seconds.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import { PREFIX, formKey } from "../page-kit.js";
import { CATEGORIES } from "./catalog.js";
import type { Cue, SoundSettings } from "./catalog.js";
import { notice, player, slider, stepper, toggle } from "./controls.js";
import { RESET_FORM, packCard, pictureCard, tryCard } from "./editor-side.js";
import { categoryMeaning, categoryName, cueTitle } from "./names.js";
import type { LibraryView } from "./views.js";

/** Not again for's named stops (sheet 02); a cue's own value the stops lack joins them. */
export const COOLDOWN_STOPS = [0, 30, 60, 120, 300, 600];
export const stopsFor = (seconds: number): number[] =>
  [...new Set([...COOLDOWN_STOPS, seconds])].sort((a, b) => a - b);

/** "Heard at 64 %: master 80 % × Something new 80 % × this cue 100 %." */
export function heard(s: SoundSettings, c: Pick<Cue, "category" | "level">): string {
  const cat = s.categories[c.category].level;
  const at = Math.round((s.volume * cat * c.level) / 10_000);
  return `Heard at ${String(at)} %: master ${String(s.volume)} % × ${categoryName(c.category)} ${String(cat)} % × this cue ${String(c.level)} %.`;
}

export function cueEditor(o: {
  cue: (Cue & { revision: number }) | null;
  library: LibraryView[];
  settings: SoundSettings;
  /** The zones a try may go to, with their names (#638). */
  zones: { key: string; name: string }[];
  canTake: boolean;
  error?: string;
  /** A new cue's name filled in: a story's "+ New cue" names it `story.<story>.<step>` (#114). */
  name?: string;
}): Html {
  const c = o.cue;
  const s = o.settings;
  const name = c?.name ?? "";
  const action = c === null ? `${PREFIX}cues/new` : `${PREFIX}cues/edit/${c.name}`;
  const category = c?.category ?? "something_new";
  const level = c?.level ?? 100;
  const chosen = c?.sounds ?? [];
  const title = (id: string) => o.library.find((l) => l.id === id)?.title ?? id;
  const stops = stopsFor(c?.cooldown_seconds ?? 0);
  const players = chosen
    .map((id) => o.library.find((l) => l.id === id))
    .filter((l) => l !== undefined);
  const head = html`<div class="moments-editor__head">
    ${
      c === null
        ? html`<label class="moments-editor__name"
            ><span class="moments-label">Name</span>
            <input
              class="canccu-input"
              name="name"
              required
              pattern="[a-z][a-z0-9_]*(\\.[a-z0-9_]+){0,2}"
              placeholder="raffle.draw"
              value="${o.name ?? ""}"
          /></label>`
        : html`<p class="moments-sub">${c.name}</p>`
    }
    <label class="moments-editor__on"
      >On ${toggle({ name: "enabled", on: c?.enabled ?? true, label: "On", enabled: true })}</label
    >
  </div>`;
  const categories = html`<fieldset class="moments-fieldset">
    <legend class="moments-label">Category</legend>
    <div class="canccu-chips">
      ${CATEGORIES.map(
        (k) =>
          html`<label class="canccu-chip"
            ><input
              type="radio"
              name="category"
              value="${k}"
              ${k === category ? "checked" : ""}
              data-name="${categoryName(k)}"
              data-level="${String(s.categories[k].level)}"
              data-meaning="${categoryMeaning(k, s)}"
            />${categoryName(k)}</label
          >`,
      )}
    </div>
    <p class="canccu-small canccu-muted" data-meaning-line>${categoryMeaning(category, s)}</p>
  </fieldset>`;
  const sounds = html`<fieldset class="moments-fieldset">
    <legend class="moments-label moments-label--split">
      <span>Sounds</span
      ><span class="canccu-small canccu-muted"
        >One is picked at random, never the same twice running</span
      >
    </legend>
    <ul class="moments-chosen" data-chosen>
      ${players.map(
        (l) =>
          html`<li data-title="${l.title}" data-url="${l.url}" data-length="${String(l.length_ms)}">
            ${player({
              id: l.id,
              title: l.title,
              url: l.url,
              length_ms: l.length_ms,
              extra: html`<label class="moments-remove"
                ><input
                  type="checkbox"
                  name="sounds"
                  value="${l.id}"
                  checked
                  aria-label="Remove ${l.title}"
                /><span aria-hidden="true">×</span></label
              >`,
            })}
          </li>`,
      )}
    </ul>
    <p class="moments-label">Add from the library</p>
    <div class="canccu-chips" data-add>
      ${o.library
        .filter((l) => !chosen.includes(l.id))
        .map(
          (l) =>
            html`<label
              class="canccu-chip"
              data-title="${l.title}"
              data-url="${l.url}"
              data-length="${String(l.length_ms)}"
              ><input type="checkbox" name="sounds" value="${l.id}" />+ ${l.title}</label
            >`,
        )}
    </div>
  </fieldset>`;
  const voice = c?.voice_line ?? null;
  const voiceChip = (id: string, label: string) =>
    html`<label class="canccu-chip"
      ><input
        type="radio"
        name="voice_line"
        value="${id}"
        ${(voice ?? "") === id ? "checked" : ""}
      />${label}</label
    >`;
  const voiceLine = html`<fieldset class="moments-fieldset">
    <legend class="moments-label">Voice line</legend>
    <div class="canccu-chips">
      ${voiceChip("", "None")}${voice === null ? "" : voiceChip(voice, title(voice))}
      <details class="moments-picker">
        <summary class="canccu-chip">+ Choose a voice line…</summary>
        <div class="canccu-chips">
          ${o.library.filter((l) => l.id !== voice).map((l) => voiceChip(l.id, l.title))}
        </div>
      </details>
    </div>
    <p class="canccu-small canccu-muted">Plays right after the sound; counts once in the budget.</p>
  </fieldset>`;
  const timing = html` ${slider({ id: "level", name: "level", label: "Level", min: 0, max: 100, value: level, format: "pct", enabled: true })}
    <p class="canccu-small canccu-muted" data-heard data-master="${String(s.volume)}">
      ${heard(s, { category, level })}
    </p>
    <input type="hidden" name="cooldown_stops" value="${stops.join(",")}" />
    ${slider({ id: "cooldown_step", name: "cooldown_step", label: "Not again for", min: 0, max: stops.length - 1, value: stops.indexOf(c?.cooldown_seconds ?? 0), format: "stops", stops, enabled: true })}
    <ol class="moments-ticks" aria-hidden="true">
      ${stops.map((t) => html`<li>${t === 0 ? "Off" : t < 60 ? `${String(t)} s` : `${String(t / 60)} min`}</li>`)}
    </ol>
    <div class="moments-fieldrow">
      <label class="moments-label" for="catch_up_minutes">Catch-up</label>
      ${stepper({ id: "catch_up_minutes", name: "catch_up_minutes", label: "Catch-up in minutes", value: (c?.catch_up_seconds ?? 120) / 60, min: 0, max: 60, by: 1, unit: "min", less: "One minute less", more: "One minute more", enabled: true })}
      <p class="canccu-small canccu-muted">
        If a moment is missed (a screen was off), it may still sound this long after.
      </p>
    </div>
    ${c?.catch_up_before_start == null ? "" : html`<input type="hidden" name="catch_up_before_start" value="${c.catch_up_before_start.join(",")}" />`}
    <div class="moments-fieldrow">
      <label class="moments-label" for="once_per_source">Once per source</label>
      ${toggle({ id: "once_per_source", name: "once_per_source", on: c?.once_per_source ?? false, label: "Once per source", enabled: true })}
      <p class="canccu-small canccu-muted">Each source sounds it once, within 7 days.</p>
    </div>`;
  return html`${notice(undefined, o.error)}
    <form class="moments-editor" method="post" action="${action}" data-editor>
      ${formKey()}<input type="hidden" name="revision" value="${c?.revision ?? 0}" />
      ${head}
      <div class="moments-editor__grid">
        <section class="canccu-card moments-editor__sound">
          <h2 class="canccu-card__title">Sound</h2>
          ${categories}${sounds}${voiceLine}${timing}
        </section>
        <div class="moments-editor__side">
          ${pictureCard({ cue: c, name: name === "" ? (o.name ?? "") : name })}
          ${tryCard({ name, zones: o.zones, canTake: o.canTake })} ${packCard({ cue: c, title })}
        </div>
      </div>
      <div class="canccu-savebar">
        <span class="canccu-savebar__text" data-unsaved>Save or cancel.</span>
        <a class="canccu-button canccu-button--secondary" href="${PREFIX}cues">Cancel</a>
        <button class="canccu-button canccu-button--primary" type="submit">Save</button>
      </div>
    </form>
    ${c === null ? "" : html`<form id="${RESET_FORM}" method="post" action="${PREFIX}cues/edit/${c.name}/delete"></form>`}`;
}

/** The editor's page title: the cue's plain name. */
export const editorTitle = (name: string | null): string =>
  name === null ? "New cue" : cueTitle(name);
