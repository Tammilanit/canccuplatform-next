/**
 * The cue editor's side column (#626, the step 4 polish sheet 02; book shot O10): Picture with its
 * effect chips, the hold slider and a small live preview; Try it, here or on a zone; and the card
 * that says what changed from the default pack, with Reset to default, or that the cue is the
 * event's own, with Remove.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import { PREFIX } from "../page-kit.js";
import { BUILTIN_CUES, EFFECTS, HOLD_MAX, HOLD_MIN } from "./catalog.js";
import type { Cue } from "./catalog.js";
import { said, slider } from "./controls.js";
import { categoryName, cueTitle } from "./names.js";

/** The form outside the editor's that Reset and Remove submit; a form cannot hold another. */
export const RESET_FORM = "moments-cue-reset";

const effectName = (e: string): string => {
  const w = e.replace("_", " ");
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** What the event changed from the built-in's seed, in words; empty when nothing. */
export function changesFromSeed(cue: Cue, seed: Cue, title: (id: string) => string): string[] {
  const out: string[] = [];
  if (cue.category !== seed.category) out.push(`category ${categoryName(cue.category)}`);
  for (const s of cue.sounds) if (!seed.sounds.includes(s)) out.push(`${title(s)} added`);
  for (const s of seed.sounds) if (!cue.sounds.includes(s)) out.push(`${title(s)} removed`);
  if (cue.voice_line !== seed.voice_line)
    out.push(cue.voice_line === null ? "no voice line" : `voice line ${title(cue.voice_line)}`);
  if (cue.level !== seed.level) out.push(`level ${String(cue.level)} %`);
  if (cue.cooldown_seconds !== seed.cooldown_seconds)
    out.push(`not again for ${said("secs", cue.cooldown_seconds)}`);
  if (cue.catch_up_seconds !== seed.catch_up_seconds)
    out.push(`catch-up ${said("secs", cue.catch_up_seconds)}`);
  if (cue.once_per_source !== seed.once_per_source)
    out.push(cue.once_per_source ? "once per source" : "not once per source");
  if (cue.effects.join() !== seed.effects.join())
    out.push(
      cue.effects.length === 0 ? "sound only" : `effects ${cue.effects.map(effectName).join(", ")}`,
    );
  if (cue.hold_seconds !== seed.hold_seconds)
    out.push(`picture holds ${said("secs", cue.hold_seconds)}`);
  if (cue.enabled !== seed.enabled) out.push(cue.enabled ? "turned on" : "turned off");
  return out;
}

export function pictureCard(o: { cue: Cue | null; name: string }): Html {
  const c = o.cue;
  const chosen = c?.effects ?? ["pop", "glow"];
  const word = cueTitle(o.name === "" ? "cue" : o.name).split(" ")[0] ?? "";
  return html`<section class="canccu-card moments-editor__picture">
    <h2 class="canccu-card__title">Picture</h2>
    <fieldset class="moments-fieldset">
      <legend class="moments-label">Effects</legend>
      <div class="canccu-chips">
        ${EFFECTS.map(
          (e) =>
            html`<label class="canccu-chip"
              ><input type="checkbox" name="effects" value="${e}" ${chosen.includes(e) ? "checked" : ""} data-label="effects" />${effectName(e)}</label
            >`,
        )}
      </div>
      <p class="canccu-small canccu-muted">Picked at random, never twice running. None: the cue only sounds.</p>
    </fieldset>
    ${slider({ id: "hold_seconds", name: "hold_seconds", label: "Holds for", min: HOLD_MIN, max: HOLD_MAX, step: 1, value: c?.hold_seconds ?? 60, format: "secs", enabled: true })}
    <div class="moments-mini" aria-hidden="true">
      <span></span><span class="moments-mini__box" data-preview-box>${word}</span><span></span>
      <span></span><span></span><span></span>
    </div>
    <p class="canccu-small canccu-muted">
      The chosen effects play here when you try the cue: the move once, then the frame and glow
      hold and fade.
    </p>
  </section>`;
}

/** A new cue is tried here only: a zone's try goes through the saved cue's path. */
export function tryCard(o: { name: string; zones: string[]; canTake: boolean }): Html {
  const zones = o.canTake && o.name !== "" ? o.zones : [];
  const where = [["here", "Here"], ...zones.map((z) => [z, z])];
  return html`<section class="canccu-card">
    <h2 class="canccu-card__title">Try it</h2>
    <fieldset class="moments-fieldset">
      <legend class="moments-label">Where</legend>
      <div class="moments-segments" role="radiogroup" aria-label="Where">
        ${where.map(
          ([v, label], i) =>
            html`<label class="moments-segment"
              ><input type="radio" name="try_zone" value="${v ?? ""}" ${i === 0 ? "checked" : ""} />${label}</label
            >`,
        )}
      </div>
    </fieldset>
    <p>
      <button
        class="canccu-button canccu-button--secondary"
        ${o.name === "" ? html`type="button"` : html`type="submit" formaction="${PREFIX}cues/edit/${o.name}/try"`}
        data-try
      >
        ▶ Play sound and picture
      </button>
    </p>
    <p class="canccu-small canccu-muted">
      "Here" plays in this browser; a zone plays the first sound as a sound check, silently unless
      its sound is on. Trying saves nothing.
    </p>
  </section>`;
}

export function packCard(o: { cue: Cue | null; title: (id: string) => string }): Html {
  const c = o.cue;
  if (c === null) return html``;
  if (!c.builtin)
    return html`<section class="canccu-card">
      <h2 class="canccu-card__title">The event's own</h2>
      <p class="canccu-small canccu-muted">This cue is not in the default pack.</p>
      <button class="canccu-button canccu-button--ghost canccu-danger-link" type="submit" form="${RESET_FORM}">Remove this cue</button>
    </section>`;
  const seed = BUILTIN_CUES.find((b) => b.name === c.name);
  const changes = seed === undefined ? [] : changesFromSeed(c, seed, o.title);
  return html`<section class="canccu-card">
    <h2 class="canccu-card__title">From the default pack</h2>
    ${
      changes.length === 0
        ? html`<p class="canccu-small canccu-muted">Same as the default pack.</p>`
        : html`<p class="canccu-small">Changed here: ${changes.join(", ")}.</p>
            <button class="canccu-button canccu-button--ghost canccu-danger-link" type="submit" form="${RESET_FORM}">Reset to default</button>`
    }
  </section>`;
}
