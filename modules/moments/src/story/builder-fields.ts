/**
 * The builder's controls (step 4 polish sheets 05 and 06), in `packages/ui` classes where the kit
 * has one: a field with its label above, a switch, a two- or three-way switch, and a chip that
 * opens its own small form. Every control is a plain form field, so the builder saves without the
 * script; a chip is a `<details>`, so it opens without it too.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";

export const str = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";

export const opt = (value: string, label: string, current: string | null | undefined) =>
  html`<option value="${value}" ${value === (current ?? "") ? "selected" : ""}>${label}</option>`;

/** A field: its label above it. `data-field` names it for the grid; `data-for` lists the step
 * templates it belongs to (the stylesheet shows it only for those). */
export function field(
  id: string,
  label: Html | string,
  input: Html,
  o: { name?: string; for?: string; hint?: Html | string; wide?: boolean } = {},
): Html {
  return html`<div
    class="canccu-field moments-field${o.wide === true ? " moments-field--wide" : ""}"
    ${o.name === undefined ? "" : html`data-field="${o.name}"`}
    ${o.for === undefined ? "" : html`data-for="${o.for}"`}
  >
    <label class="canccu-field__label" for="${id}">${label}</label>${input}${
      o.hint === undefined ? "" : html`<p class="canccu-field__hint">${o.hint}</p>`
    }
  </div>`;
}

export function textInput(
  id: string,
  name: string,
  value: string | number | null | undefined,
  o: { placeholder?: string; mono?: boolean; number?: boolean; form?: string } = {},
): Html {
  return html`<input
    class="canccu-input${o.mono === true ? " moments-mono" : ""}"
    id="${id}"
    name="${name}"
    value="${value === null || value === undefined ? "" : String(value)}"
    ${o.placeholder === undefined ? "" : html`placeholder="${o.placeholder}"`}
    ${o.number === true ? html`inputmode="numeric"` : ""}
    ${o.form === undefined ? "" : html`form="${o.form}"`}
  />`;
}

export function select(
  id: string,
  name: string,
  options: readonly (readonly [string, string])[],
  current: string | null | undefined,
): Html {
  return html`<select class="canccu-input" id="${id}" name="${name}">
    ${options.map(([v, l]) => opt(v, l, current))}
  </select>`;
}

/** An on/off switch: a checkbox drawn as a track, its words beside it. */
export function toggle(
  name: string,
  value: string,
  on: boolean,
  label: Html | string,
  o: { id?: string; form?: string; hint?: string } = {},
): Html {
  return html`<label class="moments-switch"
    ><input
      class="moments-switch__input"
      type="checkbox"
      ${o.id === undefined ? "" : html`id="${o.id}"`}
      name="${name}"
      value="${value}"
      ${o.form === undefined ? "" : html`form="${o.form}"`}
      ${on ? "checked" : ""}
    /><span class="moments-switch__track" aria-hidden="true"></span
    ><span
      >${label}${
        o.hint === undefined ? "" : html`<span class="moments-switch__hint">${o.hint}</span>`
      }</span
    ></label
  >`;
}

/** A two- or three-way switch: radios drawn as one segmented control. */
export function segmented(
  name: string,
  options: readonly (readonly [string, string])[],
  current: string,
  o: { label: string; form?: string },
): Html {
  return html`<span class="moments-seg" role="radiogroup" aria-label="${o.label}"
    >${options.map(
      ([v, l]) =>
        html`<label class="moments-seg__opt"
          ><input
            type="radio"
            name="${name}"
            value="${v}"
            ${o.form === undefined ? "" : html`form="${o.form}"`}
            ${v === current ? "checked" : ""}
          /><span>${l}</span></label
        >`,
    )}</span
  >`;
}

/** A chip that opens its own small form below its row: set (ticked), or one to add (a plus). */
export function chip(face: Html | string, body: Html, o: { add?: boolean; title?: string } = {}) {
  return html`<details class="moments-chip${o.add === true ? " moments-chip--add" : ""}">
    <summary class="moments-chip__face" ${o.title === undefined ? "" : html`title="${o.title}"`}>
      ${face}
    </summary>
    <div class="moments-chip__body">${body}</div>
  </details>`;
}

/** A row of chips with its label in the left column (sheet 05, 2). */
export function chipRow(label: string, sub: string, chips: Html | Html[]): Html {
  return html`<div class="moments-chiprow">
    <div class="moments-chiprow__label">
      <strong>${label}</strong><span class="canccu-small canccu-muted">${sub}</span>
    </div>
    <div class="moments-chiprow__chips">${chips}</div>
  </div>`;
}

/** A submit button that saves the form with one change (remove, add, move). */
export const change = (name: string, value: string, label: string, cls = "canccu-danger-link") =>
  html`<button class="${cls} moments-change" type="submit" name="${name}" value="${value}">
    ${label}
  </button>`;

export const secs = (ms: number): string => `${String(Math.round(ms / 100) / 10)} s`;
export const clock = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
};
export const minutes = (m: number): string =>
  m === 0 ? "T" : `${m > 0 ? "+" : "−"}${String(Math.round(Math.abs(m) * 10) / 10)}`;
