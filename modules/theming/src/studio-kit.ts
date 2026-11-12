/**
 * The brand kit page as mockup 12 and the design's Studio sheet (sheet 6) draw it (UX audit C2–C4):
 * the form beside the previews, Preview and Publish in the title row, the publish check under the
 * text font, Discard under the form as a quiet link apart from Publish. On a phone the preview
 * comes first, as one thumbnail with a switch, and Preview and Publish share a row above the bottom
 * bar. The form saves as it changes (static/studio.js), so the previews follow it.
 */
import { attrs, html, icon } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { isObject, list } from "./checks.js";
import type { DraftRow } from "./drafts.js";
import { fillTokens } from "./tokens.js";
import {
  STARTERS,
  STARTERS_WITH_EMBEDS,
  STARTER_NAMES,
  STUDIO,
  actionButton,
  brandOf,
  card,
  checkView,
  colourField,
  coloursDetails,
  fileDrop,
  root,
  status,
} from "./studio-views.js";
import type { StudioState, StudioView } from "./studio-views.js";

/** The surfaces beside the screen: each a page of the Studio's own, at the size it is drawn. */
const SURFACES: [string, string, string][] = [
  ["hub", "Phone", "The phone hub takes the same look as the screens."],
  [
    "admin",
    "Organiser pages",
    "Organiser pages keep the platform's look: a theme does not change them.",
  ],
  ["discord", "Discord", "Discord draws this itself: the theme gives the bar colour and the logo."],
];

function startView(embedsAllowed: boolean): Html {
  const starters = STARTERS.filter((name) => embedsAllowed || !STARTERS_WITH_EMBEDS.has(name)).map(
    (name) => actionButton(STARTER_NAMES[name], { "data-action": "starter", "data-starter": name }),
  );
  const missing = embedsAllowed
    ? ""
    : html`<p class="canccu-field__hint">
        The Terminal and Level-up themes hold embeds, which your role doesn't include. If you need
        them, ask an event owner to add embeds to your role.
      </p>`;
  return card(
    "Start a draft",
    html`<p>Edit a copy of what screens show now, or start from one of the platform's themes.</p>
      <p class="canccu-studio-row">
        ${actionButton("The current theme", { "data-action": "start" }, "primary")} ${starters}
      </p>
      ${missing}`,
  );
}

function logoField(state: StudioState, path: unknown): Html {
  const name = typeof path === "string" ? path.split("/").pop() : undefined;
  return fileDrop({
    id: "canccu-studio-logo",
    name: "logo_file",
    label: "Logo",
    accept: "image/png,image/jpeg,image/webp,image/svg+xml",
    title: name ?? "Add a logo",
    hint: `${name === undefined ? "" : "Choose another file to replace it. "}PNG, JPEG, WebP or SVG, up to 5 MB.`,
    image: state.logoUrl,
  });
}

function brandForm(state: StudioState, draft: DraftRow, colors: Record<string, string>): Html {
  const brand = brandOf(state);
  const images = isObject(draft.manifest.images) ? draft.manifest.images : {};
  const scheme = brand?.scheme ?? "dark";
  const hidden = (["logo", "icon"] as const).map((role) => {
    const value = images[role];
    // Prettier formats `html` templates as HTML and closes a lone `<input${…}>` with an invalid
    // end tag that repeats the attributes, so it must leave this line alone.
    // prettier-ignore
    return typeof value === "string" ? html`<input${attrs({ type: "hidden", name: role, value })}>` : "";
  });
  const schemes = (["dark", "light"] as const).map(
    (s) =>
      html`<label class="canccu-studio-segment"><input${attrs({ type: "radio", name: "scheme", value: s, checked: s === scheme })}>${s === "dark" ? "Dark" : "Light"}</label>`,
  );
  const errors = state.problems.some((p) => p.severity === "error");
  const hint = errors
    ? ""
    : state.cssChanged
      ? "The CSS changed: Publish turns on once the previews of this version have loaded."
      : "Publish makes it live: every screen and phone switches without a reload.";
  return html`<section class="canccu-card canccu-studio-card">
    <form class="canccu-studio-form" data-action="brand">
      ${hidden}${logoField(state, images.logo)}
      <div class="canccu-studio-pair">
        ${colourField({ name: "primary", label: "Primary", value: brand?.primary ?? colors.primary })}${colourField({ name: "accent", label: "Accent", value: brand?.accent ?? colors.accent })}
      </div>
      <fieldset class="canccu-field canccu-studio-scheme">
        <legend class="canccu-field__label">Scheme</legend>
        <span class="canccu-studio-segments">${schemes}</span>
      </fieldset>
      ${colourField({ name: "embed_color", label: "Discord colour", value: brand?.embed_color, fallback: brand?.primary ?? colors.primary, placeholder: "Same as primary" })}
    </form>
    ${fontField(draft)} ${checkView(state.problems, coloursDetails(brand, colors))}
    <p class="canccu-field__hint">Changes are saved as you make them.</p>
    <p class="canccu-field__hint canccu-studio-publish-hint">${hint}</p>
  </section>`;
}

/**
 * The text font (sheet 6): the system font or a font the theme holds. A family the theme does not
 * hold stays shown as chosen, so the publish check under it reads against what the field says.
 */
function fontField(draft: DraftRow): Html {
  const families = list(draft.manifest.fonts)
    .map((f) => (isObject(f) && typeof f.family === "string" ? f.family : undefined))
    .filter((f): f is string => f !== undefined);
  const tokens = isObject(draft.manifest.tokens) ? draft.manifest.tokens : {};
  const body = isObject(tokens.fonts) ? tokens.fonts.body : undefined;
  const chosen = typeof body === "string" ? body : "";
  const choices = [...new Set(chosen === "" ? families : [...families, chosen])];
  const options = choices.map(
    (family) =>
      html`<option${attrs({ value: family, selected: family === chosen })}>${family}</option>`,
  );
  const hint =
    families.length === 0
      ? html`<p class="canccu-field__hint">
          Fonts you upload under <a href="${STUDIO}advanced">Advanced</a> are offered here.
        </p>`
      : "";
  return html`<form class="canccu-studio-form canccu-studio-font" data-action="font">
    <div class="canccu-field">
      <label class="canccu-field__label" for="canccu-studio-font">Text font</label>
      <select class="canccu-input" id="canccu-studio-font" name="body">
        <option${attrs({ value: "", selected: chosen === "" })}>System font</option>${options}
      </select>
      ${hint}
    </div>
  </form>`;
}

/** Discard (sheet 6): under the form, apart from Publish, a quiet danger link that asks first. */
function discardView(state: StudioState): Html {
  const back =
    state.current > 0 ? "goes back to the published theme" : "keeps the platform's default look";
  return html`<div class="canccu-studio-discard">
    <button type="button" class="canccu-studio-danger-link" data-action="discard-ask">
      Discard draft…
    </button>
    <p class="canccu-small canccu-muted">Drops the draft's changes and ${back}. It asks first.</p>
  </div>`;
}

const preview = (surface: string, label: string, note: string, v: number | undefined): Html => {
  const src = `${STUDIO}preview/${surface}${v === undefined ? "" : `?canccu_theme=draft&v=${v}`}`;
  return html`<figure${attrs({ class: `canccu-studio-preview canccu-studio-preview--${surface}` })}><figcaption class="canccu-overline">${label}</figcaption><div class="canccu-studio-preview__box"><iframe${attrs({ class: "canccu-studio-preview__frame", src, title: `${label} preview`, "data-preview": true, tabindex: "-1" })}></iframe></div><p class="canccu-small canccu-muted">${note}</p></figure>`;
};

/**
 * The screen is the real player of one of the event's zones (screen's virtual screen), given the
 * draft's look by static/studio.js; the Studio's sample screen is the fallback where the zone
 * cannot be read.
 */
function screenPreview(state: StudioState, v: number | undefined): Html {
  const t = state.screenTheme;
  const fallback = `${STUDIO}preview/screen${v === undefined ? "" : `?canccu_theme=draft&v=${v}`}`;
  return html`<figure class="canccu-studio-preview canccu-studio-preview--screen"><div class="canccu-studio-preview__head"><figcaption class="canccu-overline">Venue screen <span class="canccu-studio-zone"></span></figcaption><select class="canccu-input canccu-studio-zones" aria-label="Zone" hidden></select><button class="canccu-button canccu-button--secondary canccu-button--sm canccu-studio-full-close" type="button" data-action="preview-close">${icon("close")}Close</button></div><div class="canccu-studio-preview__box"><button class="canccu-studio-tap" type="button" data-action="preview">${icon("monitor")}Tap to open full size</button><iframe${attrs({ class: "canccu-studio-preview__frame", title: "Venue screen preview", "data-preview": true, "data-screen-preview": true, "data-fallback-src": fallback, "data-tokens-css-url": t?.tokens_css_url, "data-css-url": t?.css_url ?? undefined, "data-logo-url": t?.logo_url ?? undefined, "data-templates": t === undefined ? undefined : JSON.stringify(t.templates), tabindex: "-1" })}></iframe></div></figure>`;
}

/** On a phone one preview shows at a time (sheet 6); static/studio-previews.css reads the choice. */
const surfaceSwitch = html`<span
  class="canccu-studio-segments canccu-studio-surfaces"
  role="radiogroup"
  aria-label="Preview"
  >${[
    ["screen", "Screen"],
    ...SURFACES.map(([s, label]) => [s, label === "Organiser pages" ? "Pages" : label]),
  ].map(
    ([surface, label]) =>
      html`<label class="canccu-studio-segment"><input${attrs({ type: "radio", name: "canccu-studio-surface", value: surface, checked: surface === "screen" })}>${label}</label>`,
  )}</span
>`;

function previewsView(state: StudioState): Html {
  const v = state.draft?.draft_version;
  return html`<section class="canccu-card canccu-studio-card canccu-studio-previews">
    <h2 class="canccu-card__title">Previews</h2>
    <p class="canccu-card__desc">
      ${
        v === undefined
          ? "What the event shows now."
          : "The real pages, drawn with the draft. They change as you edit."
      }
    </p>
    ${screenPreview(state, v)} ${surfaceSwitch}
    <div class="canccu-studio-previews__row">
      ${SURFACES.map(([surface, label, note]) => preview(surface, label, note, v))}
    </div>
  </section>`;
}

const discardDialog = html`<dialog
  class="canccu-studio-dialog"
  id="canccu-studio-discard"
  aria-labelledby="canccu-studio-discard-title"
>
  <h2 id="canccu-studio-discard-title" class="canccu-card__title">Discard the draft?</h2>
  <p>Its changes and files are dropped. Every screen and page keeps the published theme, as now.</p>
  <div class="canccu-studio-row canccu-studio-dialog__actions">
    ${actionButton("Keep editing", { "data-action": "dialog-close" })}
    ${actionButton("Discard the draft", { "data-action": "discard" }, "danger")}
  </div>
</dialog>`;

/** `embedsAllowed`: whether the session holds `theming.embeds.write`, for the starters offered. */
export function brandKitView(
  state: StudioState,
  embedsAllowed: boolean,
  viewerId: string | undefined,
): StudioView {
  const d = state.draft;
  const description = status(state, viewerId);
  if (d === undefined) {
    return {
      description,
      body: root(
        state,
        html`<div class="canccu-studio-kit">
          ${startView(embedsAllowed)}${previewsView(state)}
        </div>`,
      ),
    };
  }
  const colors = fillTokens(d.manifest.tokens ?? {}).colors;
  const errors = state.problems.some((p) => p.severity === "error");
  const held = !errors && state.cssChanged;
  const advanced =
    d.manifest.mode === "advanced"
      ? html`<p class="canccu-studio-advanced-note">
          This draft also has CSS, fonts, templates or embeds: they are under
          <a href="${STUDIO}advanced">Advanced</a>.
        </p>`
      : "";
  // Twice: in the title row, and on a phone in the row above the bottom bar (sheet 6).
  const actions = html`${actionButton(html`${icon("monitor")}Preview`, { "data-action": "preview" })}${actionButton("Publish", { "data-action": "publish", "data-needs-preview": held, disabled: errors || held }, "primary")}`;
  return {
    description,
    actions,
    body: root(
      state,
      html`${advanced}
        <div class="canccu-studio-kit">
          <div class="canccu-studio-side">${brandForm(state, d, colors)}${discardView(state)}</div>
          ${previewsView(state)}
        </div>
        <div class="canccu-studio-pendbar">${actions}</div>
        ${discardDialog}`,
    ),
  };
}
