/**
 * What every depth of the Theme studio shares (plan issue-784 D2, D3, D17; pack sheets 1, 2 and
 * 5): the live preview column (the screen on top, the phone and a hub page side by side, the chips
 * that try how busy the screen is and the time of day) and the title row (saved, Export, Import,
 * Preview on a screen, Publish). static/studio-live.js and studio-previews.js keep the column
 * live; parts marked `data-refresh` are drawn again after each save, the rest stays as it is.
 */
import { attrs, html, icon } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { contrastRatio } from "./contrast.js";
import { screenButton, screenDialog, screenNotice } from "./studio-screen.js";
import { fillTokens } from "./tokens.js";
import { STUDIO, actionButton, status } from "./studio-views.js";
import type { StudioState } from "./studio-views.js";

/** The two hub frames: the same hub page, as a phone and as a desktop draws it. */
const HUBS: [string, string][] = [
  ["phone", "Phone"],
  ["page", "Hub page"],
];

const CHIPS: [string, string, [string, string][]][] = [
  [
    "scene",
    "How busy",
    [
      ["quiet", "Quiet"],
      ["building", "Building"],
      ["live", "Live"],
    ],
  ],
  [
    "daypart",
    "Time of day",
    [
      ["morning", "Morning"],
      ["day", "Day"],
      ["late", "Late night"],
    ],
  ],
];

const draftQuery = (v: number | undefined): string =>
  v === undefined ? "" : `?canccu_theme=draft&v=${v}`;

/**
 * The screen is the real player of one of the event's zones (screen's virtual screen) at 1920 ×
 * 1080, scaled down whole, so it lays out exactly as a paired screen does; static/studio-previews.js
 * gives it the draft. The Studio's sample screen stands in where no zone can be read.
 */
function screenFrame(state: StudioState, v: number | undefined): Html {
  const t = state.screenTheme;
  const fallback = `${STUDIO}preview/screen${draftQuery(v)}`;
  return html`<figure class="canccu-studio-preview canccu-studio-preview--screen"><div class="canccu-studio-preview__head"><figcaption class="canccu-small canccu-muted">Screen <span class="canccu-studio-zone"></span></figcaption><select class="canccu-input canccu-studio-zones" aria-label="Zone" hidden></select><button class="canccu-button canccu-button--secondary canccu-button--sm canccu-studio-full-close" type="button" data-action="preview-close">${icon("close")}Close</button></div><div class="canccu-studio-preview__box"><iframe${attrs({ class: "canccu-studio-preview__frame", title: "Screen preview", "data-preview": true, "data-screen-preview": true, "data-fallback-src": fallback, "data-tokens-css-url": t?.tokens_css_url, "data-css-url": t?.css_url ?? undefined, "data-logo-url": t?.logo_url ?? undefined, "data-templates": t === undefined ? undefined : JSON.stringify(t.templates), "data-layouts": t === undefined ? undefined : JSON.stringify(t.layouts), tabindex: "-1" })}></iframe></div><button class="canccu-studio-tap" type="button" data-action="preview">${icon("monitor")}Tap to open full size</button></figure>`;
}

const hubFrame = ([surface, label]: [string, string], v: number | undefined): Html =>
  html`<figure${attrs({ class: `canccu-studio-preview canccu-studio-preview--${surface}` })}><div class="canccu-studio-preview__box"><iframe${attrs({ class: "canccu-studio-preview__frame", "data-surface": surface, src: `${STUDIO}preview/hub${draftQuery(v)}`, title: `${label} preview`, "data-preview": true, tabindex: "-1" })}></iframe></div><figcaption class="canccu-small canccu-muted">${label}</figcaption></figure>`;

/** The chips the preview tries a moment with: only the frames change, never the draft (D21). */
const chips = html`<div class="canccu-studio-chips">
  ${CHIPS.map(
    ([name, label, options]) =>
      html`<fieldset class="canccu-studio-chips__row">
        <legend class="canccu-small canccu-muted">${label}</legend>
        <span class="canccu-studio-segments"
          >${options.map(
            ([value, text]) =>
              html`<label class="canccu-studio-segment"><input${attrs({ type: "radio", name: `canccu-live-${name}`, value })}>${text}</label>`,
          )}</span
        >
      </fieldset>`,
  )}
</div>`;

/** On a phone one frame shows at a time (sheet 1, 390 px); studio-previews.css reads the choice. */
const frameSwitch = html`<span
  class="canccu-studio-segments canccu-studio-surfaces"
  role="radiogroup"
  aria-label="Preview"
  >${[["screen", "Screen"], ...HUBS].map(
    ([surface, label]) =>
      html`<label class="canccu-studio-segment"><input${attrs({ type: "radio", name: "canccu-studio-surface", value: surface, checked: surface === "screen" })}>${label}</label>`,
  )}</span
>`;

export function previewColumn(state: StudioState): Html {
  const v = state.draft?.draft_version;
  return html`<section
    class="canccu-studio-column canccu-studio-previews"
    aria-label="Live preview"
  >
    <p class="canccu-studio-column__head">
      <span class="canccu-overline">Live preview</span>
      <span class="canccu-small canccu-muted"
        >${v === undefined ? "What the event shows now" : "Follows your changes live"}</span
      >
    </p>
    ${frameSwitch}${screenFrame(state, v)}${chips}
    <div class="canccu-studio-previews__row">${HUBS.map((hub) => hubFrame(hub, v))}</div>
    ${v === undefined ? "" : screenButton}
  </section>`;
}

/**
 * A light look is one whose background reads better under black text than under white: judged on
 * the colours, not the brand's `scheme`, which an advanced draft's tokens may contradict.
 */
function isLight(background: string): boolean {
  return contrastRatio(background, "#000000") > contrastRatio(background, "#ffffff");
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

/**
 * The light-scheme warning (design sheet 6; Q11 b of docs/design/README.md: warn only, the dark
 * variant for screens comes later). Asked once, before the publish itself.
 */
// On every draft page, though only a light draft's Publish opens it: a save without a reload can
// turn the draft light, and the refreshed Publish then asks.
const lightDialog = html`<dialog
  class="canccu-studio-dialog"
  id="canccu-studio-light"
  aria-labelledby="canccu-studio-light-title"
>
  <h2 id="canccu-studio-light-title" class="canccu-card__title">A light look on venue screens</h2>
  <p>
    This draft is light. In a dark hall a light screen is bright and tiring, and it lights the room.
    Phones and organiser pages are fine.
  </p>
  <div class="canccu-studio-row canccu-studio-dialog__actions">
    ${actionButton("Keep editing", { "data-action": "dialog-close" })}
    ${actionButton("Publish as it is", { "data-action": "publish" }, "primary")}
  </div>
</dialog>`;

/** Import (D17): a package zip replaces the draft, or starts one. */
const importControl = html`<form class="canccu-studio-import" data-action="import">
  <label class="canccu-button canccu-button--secondary" for="canccu-studio-import"
    >${icon("plus")}Import</label
  ><input${attrs({ class: "canccu-studio-file", type: "file", id: "canccu-studio-import", name: "import", accept: ".zip,application/zip" })}>
</form>`;

/**
 * The title row and the dialogs it opens; on a phone the row sits above the bottom bar too.
 * Without `publishes` (Advanced), no Publish.
 */
export function depthFrame(state: StudioState, viewerId: string | undefined, publishes = true) {
  const d = state.draft;
  const description = html`<span data-refresh="status">${status(state, viewerId)}</span>`;
  if (d === undefined) return { description, actions: importControl, extra: html`` };
  const colors = fillTokens(d.manifest.tokens ?? {}).colors;
  const errors = state.problems.some((p) => p.severity === "error");
  const held = !errors && state.cssChanged;
  const light = isLight(colors.background ?? "#000000");
  const publish = actionButton(
    "Publish",
    {
      "data-action": light ? "light-ask" : "publish",
      "data-needs-preview": held,
      disabled: errors || held,
    },
    "primary",
  );
  const saved = html`<span class="canccu-studio-saved canccu-small canccu-muted" aria-live="polite"
    >${icon("check")}Saved</span
  >`;
  const exportLink = html`<a
    class="canccu-button canccu-button--secondary"
    href="/api/theming/draft/package"
    download
    >${icon("download")}Export</a
  >`;
  return {
    description,
    // Twice: in the title row, and on a phone in the row above the bottom bar (sheet 6).
    actions: html`<span class="canccu-cluster" data-refresh="actions"
      >${saved}${exportLink}${importControl}${publishes ? publish : ""}</span
    >`,
    extra: html`<div class="canccu-studio-pendbar" data-refresh="pendbar">
        ${actionButton(html`${icon("monitor")}Preview`, { "data-action": "preview" })}${publish}
      </div>
      ${screenNotice}${discardDialog}${lightDialog}${screenDialog}`,
  };
}

/** Discard (sheet 6): under the controls, apart from Publish, a quiet danger link that asks first. */
export function discardView(state: StudioState): Html {
  const back =
    state.current > 0 ? "goes back to the published theme" : "keeps the event profile's look";
  return html`<div class="canccu-studio-discard">
    <button type="button" class="canccu-studio-danger-link" data-action="discard-ask">
      Discard draft…
    </button>
    <p class="canccu-small canccu-muted">Drops the draft's changes and ${back}. It asks first.</p>
  </div>`;
}
