/**
 * My presets in the Studio (plan issue-784 D18): Save as my preset beside Export at every depth,
 * asking only for a name (the one text field the simple depths have), and the gallery's Your looks,
 * each saved preset as a thumbnail that applies it as a preset does, with Delete that asks first.
 * static/studio-mine.js opens the dialogs and sends the name.
 */
import { attrs, html, icon } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { plateOf } from "./logo-plate.js";
import type { MyPreset } from "./my-presets.js";
import { presetThumbnail } from "./preset-thumbs.js";
import { actionButton } from "./studio-views.js";
import type { StudioState } from "./studio-views.js";
import { colorVars } from "./studio-gallery.js";

export const saveMineButton = html`<button
  type="button"
  class="canccu-button canccu-button--secondary"
  data-mine-ask="canccu-studio-mine-save"
>
  ${icon("plus")}Save as my preset…
</button>`;

export const saveMineDialog = html`<dialog
  class="canccu-studio-dialog"
  id="canccu-studio-mine-save"
  aria-labelledby="canccu-studio-mine-save-title"
>
  <form class="canccu-studio-form" data-mine-save>
    <h2 id="canccu-studio-mine-save-title" class="canccu-card__title">Save as my preset</h2>
    <label class="canccu-field">
      <span class="canccu-field__label">Name</span>
      <input class="canccu-input" name="name" maxlength="60" required autocomplete="off" />
      <span class="canccu-field__hint"
        >For example Spring look. It's kept under Your looks in Pick a look, with this look's
        colours, fonts, pictures and files.</span
      >
    </label>
    <p class="canccu-studio-mine-error canccu-field__error" role="alert" hidden></p>
    <div class="canccu-studio-row canccu-studio-dialog__actions">
      ${actionButton("Cancel", { "data-action": "dialog-close" })}
      <button type="submit" class="canccu-button canccu-button--primary">Save</button>
    </div>
  </form>
</dialog>`;

const deleteDialog = html`<dialog
  class="canccu-studio-dialog"
  id="canccu-studio-mine-delete"
  aria-labelledby="canccu-studio-mine-delete-title"
>
  <h2 id="canccu-studio-mine-delete-title" class="canccu-card__title">Delete this preset?</h2>
  <p>
    <strong class="canccu-studio-mine-name"></strong> goes from Your looks. A draft made from it
    keeps its look.
  </p>
  <div class="canccu-studio-row canccu-studio-dialog__actions">
    ${actionButton("Keep it", { "data-action": "dialog-close" })}
    ${actionButton("Delete", { "data-action": "mine-delete" }, "danger")}
  </div>
</dialog>`;

function mineButton(state: StudioState, p: MyPreset, chosen: boolean, allowed: boolean): Html {
  const thumb = presetThumbnail(p.colors, {
    id: `canccu-thumb-mine-${p.id.slice(p.id.indexOf(":") + 1)}`,
    logoUrl: state.logoUrl,
    plate: state.draft === undefined ? undefined : plateOf(state.draft.manifest),
    headingFamily: "system-ui",
    radius: 3,
  });
  // prettier-ignore
  return html`<div class="canccu-studio-mine">
    <button${attrs({ type: "button", class: "canccu-studio-scheme", "data-action": "preset", "data-preset": p.id, "data-vars": colorVars(p.colors), "aria-pressed": chosen ? "true" : "false", disabled: !allowed })}>${thumb}<span class="canccu-studio-scheme__name">${p.name}${chosen ? icon("check") : ""}</span></button>
    <button${attrs({ type: "button", class: "canccu-studio-danger-link canccu-small", "data-mine-ask": "canccu-studio-mine-delete", "data-id": p.id, "data-name": p.name, "aria-label": `Delete ${p.name}` })}>Delete</button>
  </div>`;
}

/** Your looks: the event's saved presets first in the gallery, or how to make one. */
export function mineSection(
  state: StudioState,
  chosen: string | undefined,
  embedsAllowed: boolean,
): Html {
  const body =
    state.mine.length === 0
      ? html`<p class="canccu-field__hint">
          ${
            state.draft === undefined
              ? html`Pick a look below and make it yours, then save it here with Save as my preset.`
              : html`Save this draft with <strong>Save as my preset…</strong> at the top of the page
                  to use it again later.`
          }
        </p>`
      : html`<div class="canccu-studio-schemes">
          ${state.mine.map((p) =>
            mineButton(state, p, chosen === `${p.id}/own`, embedsAllowed || !p.embeds),
          )}
        </div>`;
  return html`<section class="canccu-studio-preset" id="canccu-studio-mine">
    <h2 class="canccu-studio-preset__title">
      Your looks
      <span class="canccu-small canccu-muted">Saved from this event's drafts.</span>
    </h2>
    ${body}${deleteDialog}
  </section>`;
}
