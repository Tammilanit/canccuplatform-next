/**
 * "Preview on a screen…" in the Theme studio (design sheet 6; contracts/theming.md, On a screen;
 * contracts/screen.md, Preview on a screen): which screen, for how long, and the notice while it
 * runs. The markup only; static/studio-screen.js lists the event's screens, takes a draft key,
 * starts the preview at Screen and keeps the screen on the draft after each change.
 */
import { attrs, html, icon } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { actionButton } from "./studio-views.js";

/** How long a preview runs: the mockup's three choices, `null` until it is ended. */
const DURATIONS: [string, string][] = [
  ["2", "2 min"],
  ["5", "5 min"],
  ["", "Until I end it"],
];

export const screenButton = actionButton(html`${icon("monitor")}Preview on a screen…`, {
  "data-screen-preview": "open",
});

/** Under the title while a preview of the draft runs on one of the event's screens. */
export const screenNotice = html`<div
  class="canccu-notice canccu-studio-screen-notice"
  data-screen-preview-notice
  hidden
>
  <div class="canccu-notice__body">
    <p class="canccu-notice__title" data-screen-preview-title></p>
    <p>That screen shows your draft. Every other screen shows the published theme.</p>
    <div class="canccu-notice__actions">
      <button
        class="canccu-button canccu-button--secondary canccu-button--sm"
        type="button"
        data-screen-preview="end"
      >
        End preview
      </button>
    </div>
  </div>
</div>`;

const duration = ([value, label]: [string, string], i: number): Html =>
  html`<label class="canccu-studio-pick"
    ><input${attrs({ class: "canccu-check", type: "radio", name: "minutes", value, checked: i === 0 })} />${label}</label
  >`;

export const screenDialog = html`<dialog
  class="canccu-studio-dialog"
  id="canccu-studio-screen"
  aria-labelledby="canccu-studio-screen-title"
>
  <form class="canccu-form canccu-studio-screen-form" data-screen-preview-form>
    <h2 id="canccu-studio-screen-title" class="canccu-card__title">
      Preview the draft on a screen
    </h2>
    <fieldset class="canccu-studio-screens">
      <legend class="canccu-field__label">Screen</legend>
      <div data-screen-preview-list>
        <p class="canccu-small canccu-muted">Reading the event's screens…</p>
      </div>
    </fieldset>
    <fieldset class="canccu-studio-screens">
      <legend class="canccu-field__label">For</legend>
      <div class="canccu-studio-row">${DURATIONS.map(duration)}</div>
    </fieldset>
    <p class="canccu-small canccu-muted">
      Only that screen shows the draft, with a "Preview" mark in its corner. It goes back to the
      published theme by itself.
    </p>
    <p class="canccu-field__error" data-screen-preview-error hidden></p>
    <div class="canccu-studio-row canccu-studio-dialog__actions">
      ${actionButton("Cancel", { "data-action": "dialog-close" })}
      <button class="canccu-button canccu-button--primary" type="submit">Start preview</button>
    </div>
  </form>
</dialog>`;
