/**
 * What the Studio pages show (plan issue-185 D8–D10): the state they read, the brand kit page and
 * the parts the other pages share. Every control is marked `data-action`, which
 * static/studio.js turns into a call of the JSON API; the markup holds no script and no `style`.
 */
import type { SqlClient } from "@canccu/kit";
import { COLOR_TOKENS, attrs, html } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import { generateColors } from "./brand.js";
import type { Brand } from "./brand.js";
import type { Problem } from "./checks.js";
import { isObject } from "./checks.js";
import { compiledCss } from "./compile.js";
import { contrastRatio } from "./contrast.js";
import { StyleError } from "./css.js";
import { loadDraft } from "./drafts.js";
import type { DraftRow } from "./drafts.js";
import { FILE_NAME, fileName } from "./files.js";
import type { FileStore } from "./files.js";
import { EMBEDS } from "./http.js";
import { SERVED } from "./theme.js";
import { fillTokens } from "./tokens.js";

export const STUDIO = "/theming/studio/";
export const STARTERS = ["default", "terminal", "level-up"] as const;
/**
 * The starters that hold embeds, so uploading one needs `theming.embeds.write` as well; a writer
 * without it is not offered them (test/studio.test.ts checks this against events/demo/themes/).
 */
export const STARTERS_WITH_EMBEDS: ReadonlySet<string> = new Set(["terminal", "level-up"]);
const SURFACES: [string, string][] = [
  ["screen", "Screen"],
  ["hub", "Phone hub"],
  ["admin", "Admin (tokens only, no event CSS)"],
  ["discord", "Discord"],
];

export interface StudioState {
  draft: DraftRow | undefined;
  current: number;
  /** Whether publishing the draft changes the compiled CSS, so its preview must be seen first (D10). */
  cssChanged: boolean;
  /** The draft logo's address, when it has one. */
  logoUrl: string | undefined;
}

/** The address of the draft file at a package path, when it holds a served one. */
export async function draftFileUrl(c: SqlClient, path: unknown): Promise<string | undefined> {
  if (typeof path !== "string") return undefined;
  const { rows } = await c.query(
    `SELECT file FROM theming_package_files WHERE owner = 'draft' AND path = $1`,
    [path],
  );
  const file = (rows[0] as { file: string | null } | undefined)?.file;
  return file !== undefined && file !== null && FILE_NAME.test(file)
    ? `/theming/draft/${file}`
    : undefined;
}

/** `compare` false skips compiling the draft's CSS, for pages that never hold Publish (advanced). */
export async function studioState(
  c: SqlClient,
  files: FileStore,
  compare = true,
): Promise<StudioState> {
  const draft = await loadDraft(c);
  const { rows } = await c.query(
    `SELECT revision, css FROM theming_revisions ORDER BY revision DESC LIMIT 1`,
  );
  const head = rows[0] as { revision: number; css: string | null } | undefined;
  let cssChanged = false;
  if (draft !== undefined && compare) {
    // Compiled as publish would store it, so the same CSS has the same name as the current's.
    try {
      const css = await compiledCss(c, files, "draft", draft.manifest, SERVED);
      cssChanged = (css === null ? null : fileName(css, "css")) !== (head?.css ?? null);
    } catch (err) {
      if (!(err instanceof StyleError)) throw err;
      cssChanged = true;
    }
  }
  const images = isObject(draft?.manifest.images) ? draft.manifest.images : {};
  return {
    draft,
    current: head?.revision ?? 0,
    cssChanged,
    logoUrl: draft === undefined ? undefined : await draftFileUrl(c, images.logo),
  };
}

export const card = (title: string, body: Slot): Html =>
  html`<section class="canccu-card canccu-studio-card">
    <h2 class="canccu-card__title">${title}</h2>
    ${body}
  </section>`;

export const actionButton = (
  label: string,
  action: Record<string, string | boolean | undefined>,
  variant = "secondary",
): Html =>
  html`<button${attrs({ type: "button", class: `canccu-button canccu-button--${variant}`, ...action })}>${label}</button>`;

/** The root every page script reads its versions from. */
export const root = (state: { draft?: DraftRow | undefined }, body: Slot): Html =>
  html`<div${attrs({ class: "canccu-studio", "data-draft-version": state.draft?.draft_version })}>${body}</div>`;

export function status(state: StudioState): Html {
  const d = state.draft;
  if (d === undefined) {
    return html`<p class="canccu-studio-status">
      No draft. Revision ${state.current} is on every screen.
    </p>`;
  }
  const who = d.updated_by === null ? "" : `, last changed by ${d.updated_by}`;
  return html`<p class="canccu-studio-status">
    Draft version ${d.draft_version}, ${d.manifest.mode === "advanced" ? "advanced" : "simple"}
    mode, from revision ${d.created_from ?? 0}${who}. Revision ${state.current} is on every screen.
  </p>`;
}

export function problemsView(problems: readonly Problem[]): Html {
  if (problems.length === 0) return html`<p class="canccu-studio-ok">No problems.</p>`;
  const items = problems.map(
    (p) =>
      html`<li${attrs({ class: `canccu-studio-problem canccu-studio-problem--${p.severity}` })}><strong>${p.severity === "error" ? "Error" : "Warning"}</strong> <code>${p.code}</code> <code>${p.path}</code> ${p.message}</li>`,
  );
  return html`<ul class="canccu-studio-problems">
    ${items}
  </ul>`;
}

function startView(embedsAllowed: boolean): Html {
  const starters = STARTERS.filter((name) => embedsAllowed || !STARTERS_WITH_EMBEDS.has(name)).map(
    (name) => actionButton(name, { "data-action": "starter", "data-starter": name }),
  );
  const missing = embedsAllowed
    ? ""
    : html`<p class="canccu-field__hint">
        The ${[...STARTERS_WITH_EMBEDS].join(" and ")} themes hold embeds, which need the right
        <code>${EMBEDS}</code>.
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

const chip = (hex: string): Html =>
  html`<svg class="canccu-studio-chip" viewBox="0 0 1 1" aria-hidden="true">
    <rect width="1" height="1" ${attrs({ fill: hex })} />
  </svg>`;

export const brandOf = (state: StudioState): Brand | undefined => {
  const b = state.draft?.manifest.brand;
  return isObject(b) && typeof b.primary === "string" && typeof b.accent === "string"
    ? (b as unknown as Brand)
    : undefined;
};

function brandForm(state: StudioState, colors: Record<string, string>): Html {
  const brand = brandOf(state);
  const images = isObject(state.draft?.manifest.images) ? state.draft.manifest.images : {};
  const scheme = brand?.scheme ?? "dark";
  const hidden = (["logo", "icon"] as const).map((role) => {
    const value = images[role];
    // Prettier formats `html` templates as HTML and closes a lone `<input${…}>` with an invalid
    // end tag that repeats the attributes, so it must leave this line alone.
    // prettier-ignore
    return typeof value === "string" ? html`<input${attrs({ type: "hidden", name: role, value })}>` : "";
  });
  const colour = (name: "primary" | "accent", label: string) =>
    html`<div class="canccu-field"><label class="canccu-field__label"${attrs({ for: `canccu-studio-${name}` })}>${label}</label><input${attrs({ class: "canccu-input canccu-studio-colour", type: "color", id: `canccu-studio-${name}`, name, value: (brand?.[name] ?? colors[name] ?? "#000000").slice(0, 7) })}></div>`;
  const schemes = (["dark", "light"] as const).map(
    (s) =>
      html`<label class="canccu-studio-radio"><input${attrs({ type: "radio", name: "scheme", value: s, checked: s === scheme })}> ${s === "dark" ? "Dark" : "Light"}</label>`,
  );
  const logo =
    state.logoUrl === undefined
      ? html`<p class="canccu-field__hint">No logo yet.</p>`
      : html`<img
          class="canccu-studio-logo"
          ${attrs({ src: state.logoUrl, alt: "The draft's logo" })}
        />`;
  return card(
    "Brand kit",
    html`<form class="canccu-studio-form" data-action="brand">${hidden}
<div class="canccu-field"><label class="canccu-field__label" for="canccu-studio-logo">Logo</label>${logo}<input class="canccu-input" type="file" id="canccu-studio-logo" name="logo_file" accept="image/png,image/jpeg,image/webp,image/svg+xml"><p class="canccu-field__hint">PNG, JPEG, WebP or SVG, up to 5 MB. A PNG of it is made for Discord and the hub's icons.</p></div>
${colour("primary", "Primary colour")}${colour("accent", "Accent colour")}
<fieldset class="canccu-field"><legend class="canccu-field__label">Scheme</legend>${schemes}</fieldset>
<div class="canccu-field"><label class="canccu-field__label" for="canccu-studio-embed-color">Discord embed colour</label><input${attrs({ class: "canccu-input", type: "text", id: "canccu-studio-embed-color", name: "embed_color", pattern: "#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})", placeholder: "the primary colour", value: brand?.embed_color })}></div>
<button class="canccu-button canccu-button--primary" type="submit">Save</button></form>`,
  );
}

function coloursView(state: StudioState, colors: Record<string, string>): Html {
  const swatches = Object.keys(COLOR_TOKENS).map(
    (token) =>
      html`<li class="canccu-studio-swatch" ${attrs({ "data-token": token })}>
        ${chip(colors[token] ?? "#000000")} <code>${token}</code> ${colors[token]}
      </li>`,
  );
  const brand = brandOf(state);
  const notes: Html[] = [];
  if (brand !== undefined) {
    for (const token of generateColors(brand).adjusted) {
      const given = token === "primary" ? brand.primary : brand.accent;
      notes.push(
        html`<li${attrs({ "data-adjusted": token })}>${token === "primary" ? "Primary" : "Accent"}: ${given} is shown as ${colors[token]}, so it stands out from the background (3:1).</li>`,
      );
    }
  }
  const primary = colors.primary ?? "#000000";
  const text = colors.primary_text ?? "#000000";
  const ratio = contrastRatio(text, primary).toFixed(1);
  return card(
    "Colours",
    html`<p>Text on primary uses ${text} (${ratio}:1).</p>
      ${
        notes.length > 0
          ? html`<ul class="canccu-studio-adjusted">
              ${notes}
            </ul>`
          : html`<p class="canccu-studio-ok">Every given colour is used as it is.</p>`
      }
      <ul class="canccu-studio-swatches">
        ${swatches}
      </ul>`,
  );
}

function previewView(state: StudioState): Html {
  const v = state.draft?.draft_version;
  const frames = SURFACES.map(([surface, label]) => {
    const src = `${STUDIO}preview/${surface}${v === undefined ? "" : `?canccu_theme=draft&v=${v}`}`;
    return html`<figure${attrs({ class: `canccu-studio-preview canccu-studio-preview--${surface}` })}><figcaption>${label}</figcaption><div class="canccu-studio-preview__box"><iframe${attrs({ class: "canccu-studio-preview__frame", src, title: `${label} preview`, "data-preview": true })}></iframe></div></figure>`;
  });
  return card(
    state.draft === undefined ? "What screens show now" : "Preview of this draft",
    html`<div class="canccu-studio-previews">${frames}</div>`,
  );
}

function publishView(state: StudioState, draft: DraftRow): Html {
  const errors = draft.problems.some((p) => p.severity === "error");
  const held = !errors && state.cssChanged;
  const hint = errors
    ? "Fix the errors first: a draft with an error cannot be published."
    : held
      ? "The CSS changed: Publish turns on once the preview of this version has loaded."
      : `Publishing makes revision ${state.current + 1}; every screen and hub switches without a reload.`;
  return card(
    "Publish",
    html`<p class="canccu-studio-row">
        ${actionButton("Publish", { "data-action": "publish", "data-needs-preview": held, disabled: errors || held }, "primary")}
      </p>
      <p class="canccu-field__hint canccu-studio-publish-hint">${hint}</p>
      <details class="canccu-studio-confirm">
        <summary>Discard the draft</summary>
        <p>The draft and its files go; what screens show stays.</p>
        ${actionButton("Discard the draft", { "data-action": "discard" }, "danger")}
      </details>`,
  );
}

/** `embedsAllowed`: whether the session holds `theming.embeds.write`, for the starters offered. */
export function brandKitView(state: StudioState, embedsAllowed: boolean): Html {
  const d = state.draft;
  if (d === undefined)
    return root(state, html`${status(state)}${startView(embedsAllowed)}${previewView(state)}`);
  const colors = fillTokens(d.manifest.tokens ?? {}).colors;
  return root(
    state,
    html`${status(state)} ${brandForm(state, colors)} ${coloursView(state, colors)}
    ${card("Problems", problemsView(d.problems))} ${previewView(state)} ${publishView(state, d)}`,
  );
}
