/** One cue's form on the sound desk (mockup 12): a built-in's, the event's own, or a new one. */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import { PREFIX } from "../page-kit.js";
import { CATEGORIES, EFFECTS, HOLD_MAX, HOLD_MIN } from "./catalog.js";
import type { Cue } from "./catalog.js";
import { notice, words } from "./views.js";
import type { LibraryView } from "./views.js";

export function cueForm(o: {
  cue: (Cue & { revision: number }) | null;
  library: LibraryView[];
  error?: string;
}): Html {
  const c = o.cue;
  const action = c === null ? `${PREFIX}cues/new` : `${PREFIX}cues/edit/${c.name}`;
  const box = (name: string, value: string, on: boolean, label: string) =>
    html`<label class="canccu-small"
      ><input type="checkbox" name="${name}" value="${value}" ${on ? "checked" : ""} />
      ${label}</label
    >`;
  const num = (name: keyof Cue, label: string, min: number, max: number) =>
    html`<label class="canccu-small"
      >${label}
      <input
        class="canccu-input"
        type="number"
        min="${min}"
        max="${max}"
        name="${name}"
        value="${String(c?.[name] ?? (name === "hold_seconds" ? 60 : name === "level" ? 100 : name === "catch_up_seconds" ? 120 : 0))}"
    /></label>`;
  return html`${notice(undefined, o.error)}
    <form class="canccu-card moments-cue-form" method="post" action="${action}">
      <input type="hidden" name="revision" value="${c?.revision ?? 0}" />
      ${c === null ? html`<label class="canccu-small">Name <input class="canccu-input" name="name" required pattern="[a-z][a-z0-9_]*(\\.[a-z0-9_]+){0,2}" placeholder="raffle.draw" /></label>` : html`<h2 class="canccu-card__title">${c.name}</h2>`}
      <label class="canccu-small"
        >Category
        <select class="canccu-input" name="category">
          ${CATEGORIES.map((k) => html`<option value="${k}" ${c?.category === k ? "selected" : ""}>${words(k)}</option>`)}
        </select></label
      >
      ${box("enabled", "on", c?.enabled ?? true, "On")}
      ${box("once_per_source", "on", c?.once_per_source ?? false, "Once per source (7 days)")}
      ${num("level", "Level %", 0, 100)}${num("cooldown_seconds", "Not again for (s)", 0, 86400)}${num("catch_up_seconds", "Catch-up (s)", 0, 3600)}
      ${c?.catch_up_before_start == null ? "" : html`<input type="hidden" name="catch_up_before_start" value="${c.catch_up_before_start.join(",")}" />`}
      <fieldset>
        <legend>Sounds (random, never twice running)</legend>
        ${o.library.map((l) => box("sounds", l.id, c?.sounds.includes(l.id) ?? false, l.title))}
      </fieldset>
      <label class="canccu-small"
        >Voice line
        <select class="canccu-input" name="voice_line">
          <option value="">None</option>
          ${o.library.map((l) => html`<option value="${l.id}" ${c?.voice_line === l.id ? "selected" : ""}>${l.title}</option>`)}
        </select></label
      >
      <fieldset>
        <legend>Picture: effects picked at random, never twice running</legend>
        ${EFFECTS.map((e) => box("effects", e, c?.effects.includes(e) ?? false, words(e)))}
      </fieldset>
      <label class="canccu-small"
        >Holds for (s)
        <input
          class="canccu-input"
          type="number"
          min="${HOLD_MIN}"
          max="${HOLD_MAX}"
          name="hold_seconds"
          value="${c?.hold_seconds ?? 60}"
      /></label>
      <div class="canccu-cluster">
        <button class="canccu-button canccu-button--primary" type="submit">Save</button>
        <a class="canccu-button canccu-button--ghost" href="${PREFIX}cues">Back</a>
      </div>
    </form>
    ${c === null ? "" : html`<form method="post" action="${PREFIX}cues/edit/${c.name}/delete"><button class="canccu-button canccu-button--ghost" type="submit">${c.builtin ? "Reset to default" : "Remove this cue"}</button></form>`}`;
}
