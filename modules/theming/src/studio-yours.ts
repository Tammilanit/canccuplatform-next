/**
 * Make it yours (plan issue-784 D4–D8, D11, D13, D22; pack sheet 2), the brand kit grown into
 * choices only: the logo on its plate with the plate check's suggestion, colours with swatches that
 * go with them, a font pair, corners and the screen's background. One form, saved as it changes
 * (static/studio.js) through `PUT …/draft/brand`; the frames follow before each save answers.
 */
import { attrs, html, icon, notice } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { ROUNDNESS } from "./brand.js";
import type { Brand } from "./brand.js";
import { isObject, list } from "./checks.js";
import { matchesFor } from "./colour-match.js";
import { contrastRatio } from "./contrast.js";
import type { DraftRow } from "./drafts.js";
import { FONT_PAIRS } from "./font-pairs.js";
import { plateOf } from "./logo-plate.js";
import type { LogoInfo } from "./logo-info.js";
import { presetOf } from "./studio-gallery.js";
import { backgroundSection, field, section } from "./studio-yours-background.js";
import { fillTokens } from "./tokens.js";
import {
  STUDIO,
  actionButton,
  brandOf,
  checkView,
  colourField,
  coloursDetails,
  fileDrop,
} from "./studio-views.js";
import type { StudioState } from "./studio-views.js";

/** The "Reads well" badge's bar: text contrast of 4.5:1 (WCAG AA for body text), not the 3:1 of fills. */
export const readsWell = (text: string, ground: string): boolean =>
  contrastRatio(text, ground) >= 4.5;

/** A row of chips: radio inputs drawn as segments, the form's own fields. */
function chips(name: string, options: [string, string][], checked: string): Html {
  return html`<span class="canccu-studio-segments"
    >${options.map(
      ([value, label]) =>
        html`<label class="canccu-studio-segment"><input${attrs({ type: "radio", name, value, checked: value === checked })}>${label}</label>`,
    )}</span
  >`;
}

const PLATES: [string, string][] = [
  ["none", "None"],
  ["light", "Light"],
  ["dark", "Dark"],
  ["surface", "Theme surface"],
];

function logoSection(state: StudioState, draft: DraftRow, info: LogoInfo): Html {
  const images = isObject(draft.manifest.images) ? draft.manifest.images : {};
  const path = typeof images.logo === "string" ? images.logo : undefined;
  const name = path?.split("/").pop();
  const plate = plateOf(draft.manifest);
  const stored = isObject(draft.manifest.brand) ? draft.manifest.brand.logo_plate : undefined;
  const raw = isObject(stored) ? stored : {};
  const suggest = plate === undefined ? info.advice?.suggest : null;
  const background = fillTokens(draft.manifest.tokens ?? {}).colors.background ?? "#000000";
  const dark = contrastRatio(background, "#ffffff") > contrastRatio(background, "#000000");
  const plateWord = suggest === "surface" ? "the theme's surface" : `a ${suggest ?? ""}`;
  const advice =
    suggest === undefined || suggest === null
      ? ""
      : notice({
          kind: "warn",
          title: `Your logo is hard to see on this ${dark ? "dark" : "light"} background`,
          text: "Logos need a contrast of at least 3:1 against what is behind them. A plate gives it one.",
          actions: [
            actionButton(
              `Put it on ${plateWord} plate`,
              { "data-action": "plate-suggest", "data-plate": suggest },
              "primary",
            ),
          ],
        });
  return section(
    "Logo",
    "Shown on the screens, the hub, the organiser pages and in Discord.",
    html`<div data-refresh="logo">
        ${fileDrop({
          id: "canccu-studio-logo",
          name: "logo_file",
          label: "Logo",
          accept: "image/png,image/jpeg,image/webp,image/svg+xml",
          title: name ?? "Add a logo",
          hint: `${name === undefined ? "" : "Choose another file to replace it. "}PNG, JPEG, WebP or SVG, up to 5 MB.`,
          image: state.logoUrl,
        })}
      </div>
      <div data-refresh="plate-advice">${advice}</div>
      ${field("Plate behind the logo", chips("plate_kind", PLATES, plate?.kind ?? "none"))}
      ${field(
        "Shape",
        chips(
          "plate_shape",
          [
            ["rounded", "Rounded"],
            ["circle", "Circle"],
          ],
          raw.shape === "circle" ? "circle" : "rounded",
        ),
      )}
      ${field(
        "Space around the logo",
        chips(
          "plate_padding",
          [
            ["small", "Small"],
            ["medium", "Medium"],
            ["large", "Large"],
          ],
          typeof raw.padding === "string" ? raw.padding : "medium",
        ),
      )}`,
  );
}

const badge = (ok: boolean): Html =>
  ok ? html`<span class="canccu-badge canccu-badge--ok">${icon("check")}Reads well</span>` : html``;

/** A picker with what it colours, whether text reads on it, and the swatches that go with it. */
function colourChoice(o: {
  name: "primary" | "accent";
  label: string;
  what: string;
  value: string;
  reads: boolean;
  suggestions: string[];
}): Html {
  const swatches = [...new Set(o.suggestions.map((s) => s.toLowerCase()))]
    .filter((s) => s !== o.value.toLowerCase())
    .slice(0, 6)
    .map(
      (hex) =>
        html`<button${attrs({ type: "button", class: "canccu-studio-swatch-pick", "data-action": "swatch", "data-swatch-for": o.name, "data-colour": hex, "aria-label": `Use ${hex}` })}><svg viewBox="0 0 1 1" aria-hidden="true"><rect width="1" height="1"${attrs({ fill: hex })} /></svg></button>`,
    );
  return html`<div class="canccu-studio-colour-choice">
    ${colourField({ name: o.name, label: o.label, value: o.value, required: true })}
    <p class="canccu-field__hint">
      ${o.what} <span data-refresh="reads-${o.name}">${badge(o.reads)}</span>
    </p>
    <p class="canccu-small canccu-muted">Goes well with</p>
    <div class="canccu-studio-row" data-refresh="swatches-${o.name}">${swatches}</div>
  </div>`;
}

function coloursSection(
  brand: Brand | undefined,
  colors: Record<string, string>,
  info: LogoInfo,
): Html {
  const background = colors.background ?? "#000000";
  const primary = brand?.primary ?? colors.primary ?? "#000000";
  const accent = brand?.accent ?? colors.accent ?? "#000000";
  return section(
    "Colours",
    "Pick a colour, or one that goes well with it. Text colours follow, so everything stays readable.",
    html`${colourChoice({
      name: "primary",
      label: "Main colour",
      what: "Buttons, highlights, the countdown.",
      value: primary,
      reads: readsWell(colors.primary_text ?? "#000000", colors.primary ?? "#000000"),
      suggestions: [...info.palette, ...matchesFor(primary, background)],
    })}
    ${colourChoice({
      name: "accent",
      label: "Second colour",
      what: "Labels, glows on the screens.",
      value: accent,
      reads: readsWell(colors.accent ?? "#000000", background),
      suggestions: [...info.palette, ...matchesFor(accent, background)],
    })}
    ${field(
      "Light or dark",
      chips(
        "scheme",
        [
          ["dark", "Dark"],
          ["light", "Light"],
        ],
        brand?.scheme ?? "dark",
      ),
    )}
    ${colourField({ name: "embed_color", label: "Discord colour", value: brand?.embed_color, fallback: primary, placeholder: "Same as the main colour" })}`,
  );
}

function fontsSection(brand: Brand | undefined, draft: DraftRow): Html {
  const tokens = isObject(draft.manifest.tokens) ? draft.manifest.tokens : {};
  const own =
    isObject(tokens.fonts) &&
    ["heading", "display", "body"].some((k) => k in (tokens.fonts as object));
  // A theme's own fonts (a preset's) are no pair: none is checked until one is picked.
  const chosen = brand?.font_pair ?? (own ? undefined : "");
  const option = (
    value: string,
    name: string,
    families: string,
    heading?: string,
    body?: string,
  ): Html =>
    html`<label${attrs({ class: `canccu-studio-pair canccu-studio-font--${value || "platform"}` })}><input${attrs({ type: "radio", name: "font_pair", value, checked: value === chosen, "data-heading": heading, "data-body": body })}><span class="canccu-studio-pair__name">${name}</span><span class="canccu-small canccu-muted">${families}</span></label>`;
  const pairs = [...FONT_PAIRS.values()].map((p) =>
    option(p.id, p.name, `${p.heading.family} · ${p.body.family}`, p.heading.family, p.body.family),
  );
  return section(
    "Fonts",
    "Headings and text as a matched pair. All are free fonts served from your own event.",
    html`<div class="canccu-studio-pairs">
      ${option("", "Platform font", "The device's own")}${pairs}
    </div>`,
  );
}

/** The roundness the draft shows: the brand's choice, else the one its radius matches. */
function roundnessOf(brand: Brand | undefined, draft: DraftRow): string {
  if (brand?.roundness !== undefined) return brand.roundness;
  const tokens = isObject(draft.manifest.tokens) ? draft.manifest.tokens : {};
  const own = isObject(tokens.sizes) ? tokens.sizes.radius : undefined;
  const radius = own ?? fillTokens(tokens).sizes.radius;
  // A radius of the theme's own (a preset's) that no choice matches shows none checked, so a save
  // sends no corners and keeps it.
  return (
    Object.entries(ROUNDNESS).find(([, v]) => v === radius)?.[0] ??
    (own === undefined ? "soft" : "")
  );
}

export function resetView(state: StudioState): Html {
  const from = presetOf(state);
  if (from === undefined) {
    return html`<p class="canccu-studio-row" data-refresh="reset">
      <a class="canccu-button canccu-button--secondary" href="${STUDIO}"
        >Start again from a preset…</a
      >
    </p>`;
  }
  const name = from.name;
  return html`<div data-refresh="reset">
    <p class="canccu-studio-row">
      ${actionButton(html`${icon("refresh")}Reset to ${name}`, { "data-action": "reset-ask" }, "ghost")}
    </p>
    <dialog
      class="canccu-studio-dialog"
      id="canccu-studio-reset"
      aria-labelledby="canccu-studio-reset-title"
    >
      <h2 id="canccu-studio-reset-title" class="canccu-card__title">Reset to ${name}?</h2>
      <p>
        The colours, fonts, corners and background go back to the preset's. Your logo and its plate
        stay.
      </p>
      <p class="canccu-studio-own-note">
        Your draft has its own CSS, fonts, templates or embeds. Resetting drops them. Export the
        draft first to keep a copy.
      </p>
      <div class="canccu-studio-row canccu-studio-dialog__actions">
        ${actionButton("Keep my changes", { "data-action": "dialog-close" })}
        ${actionButton(`Reset to ${name}`, { "data-action": "preset", "data-preset": from.id, "data-scheme": from.scheme }, "primary")}
      </div>
    </dialog>
  </div>`;
}

/** The text font of a theme that holds its own fonts (Advanced uploads them): kept as it was. */
function ownFont(draft: DraftRow): Html | string {
  const families = list(draft.manifest.fonts)
    .map((f) => (isObject(f) && typeof f.family === "string" ? f.family : undefined))
    .filter((f): f is string => f !== undefined);
  const tokens = isObject(draft.manifest.tokens) ? draft.manifest.tokens : {};
  const body = isObject(tokens.fonts) ? tokens.fonts.body : undefined;
  const chosen = typeof body === "string" ? body : "";
  // Also a family no package holds, so the publish check reads against what the field says.
  if (families.length === 0 && chosen === "") return "";
  const options = [...new Set([...families, ...(chosen === "" ? [] : [chosen])])].map(
    (family) =>
      html`<option${attrs({ value: family, selected: family === chosen })}>${family}</option>`,
  );
  return html`<form class="canccu-studio-form canccu-studio-font" data-action="font">
    <div class="canccu-field">
      <label class="canccu-field__label" for="canccu-studio-font">Text font</label>
      <select class="canccu-input" id="canccu-studio-font" name="body">
        <option${attrs({ value: "", selected: chosen === "" })}>System font</option>${options}
      </select>
      <p class="canccu-field__hint">One of the fonts this theme holds; a pair above replaces it.</p>
    </div>
  </form>`;
}

function publishHint(state: StudioState): string {
  if (state.problems.some((p) => p.severity === "error")) return "";
  return state.cssChanged
    ? "The CSS changed: Publish turns on once the previews of this version have loaded."
    : "Publish makes it live: every screen and phone switches without a reload.";
}

export function yoursView(state: StudioState, draft: DraftRow, info: LogoInfo): Html {
  const brand = brandOf(state);
  const colors = fillTokens(draft.manifest.tokens ?? {}).colors;
  const images = isObject(draft.manifest.images) ? draft.manifest.images : {};
  // prettier-ignore
  const hidden = (["logo", "icon"] as const).map((role) => typeof images[role] === "string" ? html`<input${attrs({ type: "hidden", name: role, value: images[role] })}>` : "");
  const advanced =
    draft.manifest.mode === "advanced"
      ? html`<p class="canccu-studio-advanced-note">
          This look also has CSS, fonts, templates or embeds: they are under
          <a href="${STUDIO}advanced">Advanced</a>.
        </p>`
      : "";
  return html`<div class="canccu-studio-controls">
    ${advanced}
    <form class="canccu-studio-form canccu-studio-yours" data-action="brand">
      ${hidden}${logoSection(state, draft, info)}${coloursSection(brand, colors, info)}
      ${fontsSection(brand, draft)}
      ${section(
        "Corners",
        "",
        chips(
          "roundness",
          [
            ["square", "Square"],
            ["soft", "Soft"],
            ["round", "Round"],
            ["pill", "Pill"],
          ],
          roundnessOf(brand, draft),
        ),
      )}
      ${backgroundSection(brand, colors)}
    </form>
    ${ownFont(draft)}
    <div data-refresh="check">${checkView(state.problems, coloursDetails(brand, colors))}</div>
    ${resetView(state)}
    <p class="canccu-field__hint">Changes are saved as you make them.</p>
    <p class="canccu-field__hint canccu-studio-publish-hint" data-refresh="publish-hint">
      ${publishHint(state)}
    </p>
  </div>`;
}
