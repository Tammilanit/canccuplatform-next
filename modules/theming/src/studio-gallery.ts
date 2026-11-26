/**
 * Pick a look (plan issue-784 D1, D9–D12; pack sheet 1): every preset with its schemes as
 * thumbnails, one click applying one to the draft (`PUT /api/theming/draft/preset`). The event's
 * logo and its plate stay whichever is picked, so the thumbnails draw them too.
 */
import { attrs, html, icon, notice } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { isObject } from "./checks.js";
import { plateOf } from "./logo-plate.js";
import { presetThumbnail } from "./preset-thumbs.js";
import { PRESETS, schemeColors } from "./presets.js";
import type { Preset, Scheme } from "./presets.js";
import { ROUNDNESS } from "./brand.js";
import { STUDIO, actionButton, card } from "./studio-views.js";
import type { StudioState } from "./studio-views.js";
import { cssVar } from "@canccu/ui";

const KINDS: Record<Scheme["kind"], string> = {
  dark: "Dark",
  light: "Light",
  contrast: "High contrast",
  accent: "Colour variant",
};

/** The draft's preset, as the gallery marks it and Reset names it. */
export function presetOf(state: StudioState): { preset: Preset; scheme: Scheme } | undefined {
  const p = state.draft?.manifest.preset;
  if (!isObject(p)) return undefined;
  const preset = PRESETS.get(String(p.id));
  const scheme = preset?.schemes.find((s) => s.id === p.scheme);
  return preset === undefined || scheme === undefined ? undefined : { preset, scheme };
}

/** The thumbnail's radius in its own units: the preset's corners, a sixth of their size. */
function radiusOf(preset: Preset): number {
  const tokens = isObject(preset.manifest.tokens) ? preset.manifest.tokens : {};
  const sizes = isObject(tokens.sizes) ? tokens.sizes : {};
  const brand = isObject(preset.manifest.brand) ? preset.manifest.brand : {};
  const given =
    typeof sizes.radius === "string"
      ? sizes.radius
      : ROUNDNESS[(brand.roundness as keyof typeof ROUNDNESS | undefined) ?? "soft"];
  const n = parseFloat(given);
  return Number.isNaN(n) ? 3 : given.endsWith("rem") ? (n * 16) / 3 : n / 3;
}

function headingOf(preset: Preset): string {
  const tokens = isObject(preset.manifest.tokens) ? preset.manifest.tokens : {};
  const fonts = isObject(tokens.fonts) ? tokens.fonts : {};
  return typeof fonts.heading === "string" ? fonts.heading : "system-ui";
}

/** The scheme's colours as the frames take them live, before the draft has saved (D3). */
const liveVars = (scheme: Scheme): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(schemeColors(scheme)).map(([token, value]) => [cssVar("color", token), value]),
    ),
  );

function schemeButton(
  state: StudioState,
  preset: Preset,
  scheme: Scheme,
  o: { chosen: boolean; allowed: boolean },
): Html {
  const thumb = presetThumbnail(schemeColors(scheme), {
    id: `canccu-thumb-${preset.id}-${scheme.id}`,
    logoUrl: state.logoUrl,
    plate: state.draft === undefined ? undefined : plateOf(state.draft.manifest),
    headingFamily: headingOf(preset),
    radius: radiusOf(preset),
  });
  return html`<button${attrs({ type: "button", class: "canccu-studio-scheme", "data-action": "preset", "data-preset": preset.id, "data-scheme": scheme.id, "data-vars": liveVars(scheme), "aria-pressed": o.chosen ? "true" : "false", disabled: !o.allowed })}>${thumb}<span class="canccu-studio-scheme__name">${scheme.name}${o.chosen ? icon("check") : ""}</span><span class="canccu-small canccu-muted">${KINDS[scheme.kind]}</span></button>`;
}

function presetSection(
  state: StudioState,
  preset: Preset,
  chosen: string | undefined,
  embedsAllowed: boolean,
): Html {
  const allowed = embedsAllowed || !preset.embeds;
  return html`<section class="canccu-studio-preset">
    <h2 class="canccu-studio-preset__title">
      ${preset.name}
      ${
        preset.description === undefined
          ? ""
          : html`<span class="canccu-small canccu-muted">${preset.description}</span>`
      }
    </h2>
    <div class="canccu-studio-schemes">
      ${preset.schemes.map((s) =>
        schemeButton(state, preset, s, { chosen: chosen === `${preset.id}/${s.id}`, allowed }),
      )}
    </div>
  </section>`;
}

/** `embedsAllowed`: whether the session holds `theming.embeds.write`, for the presets offered. */
export function galleryView(state: StudioState, embedsAllowed: boolean): Html {
  const from = presetOf(state);
  const chosen = from === undefined ? undefined : `${from.preset.id}/${from.scheme.id}`;
  const presets = [...PRESETS.values()];
  const held = presets.filter((p) => p.embeds && !embedsAllowed).map((p) => p.name);
  const missing =
    held.length === 0
      ? ""
      : html`<p class="canccu-field__hint">
          ${held.join(" and ")} hold embeds, which your role doesn't include. If you need them, ask
          an event owner to add embeds to your role.
        </p>`;
  const start =
    state.draft === undefined
      ? card(
          "Or keep what screens show now",
          html`<p>Edit a copy of the current theme instead of a preset.</p>
            <p class="canccu-studio-row">
              ${actionButton("Start from the current theme", { "data-action": "start" })}
            </p>`,
        )
      : html`<p class="canccu-studio-next">
          <a class="canccu-button canccu-button--primary" href="${STUDIO}yours"
            >Make it yours${icon("right")}</a
          >
        </p>`;
  return html`<div class="canccu-studio-controls" data-refresh="gallery">
    ${notice({
      kind: "info",
      title: "Pick a look, then make it yours",
      text: "One click tries a look in the preview. Your logo and its plate stay whichever you pick.",
    })}
    ${missing}${presets.map((p) => presetSection(state, p, chosen, embedsAllowed))} ${start}
  </div>`;
}
