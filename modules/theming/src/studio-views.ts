/**
 * What the Studio pages show (plan issue-185 D8–D10; UX audit C1, C2, C5): the state they read
 * and the parts the pages share: the status line, the publish check and the colour fields. Every
 * control is marked `data-action`, which static/studio.js turns into a call of the JSON API; the
 * markup holds no script and no `style`.
 */
import type { SqlClient } from "@canccu/kit";
import { COLOR_TOKENS, attrs, html, notice } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import { generateColors } from "./brand.js";
import type { Brand } from "./brand.js";
import type { Problem } from "./checks.js";
import { isObject } from "./checks.js";
import { compiledCss, parsedTemplates } from "./compile.js";
import { contrastRatio } from "./contrast.js";
import { StyleError } from "./css.js";
import { draftProblems, loadDraft } from "./drafts.js";
import type { DraftRow } from "./drafts.js";
import { FILE_NAME, fileName } from "./files.js";
import type { FileStore } from "./files.js";
import { SERVED } from "./theme.js";

export const STUDIO = "/theming/studio/";
export const STARTERS = ["default", "terminal", "level-up"] as const;
export const STARTER_NAMES: Record<(typeof STARTERS)[number], string> = {
  default: "Default",
  terminal: "Terminal",
  "level-up": "Level-up",
};
/**
 * The starters that hold embeds, so uploading one needs `theming.embeds.write` as well; a writer
 * without it is not offered them (test/studio.test.ts checks this against events/demo/themes/).
 */
export const STARTERS_WITH_EMBEDS: ReadonlySet<string> = new Set(["terminal", "level-up"]);

/** The colour tokens as organisers name them; ids stay in the markup's data attributes only. */
export const COLOUR_NAMES: Record<keyof typeof COLOR_TOKENS, string> = {
  background: "Background",
  surface: "Cards",
  border: "Lines",
  text: "Text",
  text_muted: "Muted text",
  primary: "Primary",
  primary_text: "Text on primary",
  accent: "Accent",
  status_ok: "Running",
  status_degraded: "Slow",
  status_down: "Down",
};

/** Every colour the schema takes (contracts/theme.schema.json, `color`). */
export const COLOUR_PATTERN = "#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})";

export interface StudioState {
  draft: DraftRow | undefined;
  /** Publish's own check of the draft, run again for the page (UX audit C1). */
  problems: Problem[];
  current: number;
  /** Whether publishing the draft changes the compiled CSS, so its preview must be seen first (D10). */
  cssChanged: boolean;
  /** The draft logo's address, when it has one. */
  logoUrl: string | undefined;
  /** What the screen preview gives the real player in place of the published theme. */
  screenTheme: ScreenTheme | undefined;
}

/** The draft's part of a `ScreenState`'s `theme` (contracts/screen.md), at its draft addresses. */
export interface ScreenTheme {
  tokens_css_url: string;
  css_url: string | null;
  logo_url: string | null;
  templates: unknown[];
}

/** A page's body and what goes in the shell's title row. */
export interface StudioView {
  body: Html;
  description?: Slot;
  actions?: Slot;
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
  const logoUrl = draft === undefined ? undefined : await draftFileUrl(c, images.logo);
  return {
    draft,
    problems: draft === undefined ? [] : await draftProblems(c, draft.manifest),
    current: head?.revision ?? 0,
    cssChanged,
    logoUrl,
    screenTheme:
      draft === undefined || !compare ? undefined : await screenTheme(c, files, draft, logoUrl),
  };
}

async function screenTheme(
  c: SqlClient,
  files: FileStore,
  draft: DraftRow,
  logoUrl: string | undefined,
): Promise<ScreenTheme> {
  const v = `?v=${draft.draft_version}`;
  let templates: unknown[] = [];
  try {
    templates = await parsedTemplates(c, files, "draft", draft.manifest, "/theming/draft/");
  } catch (err) {
    // The draft's problems already name it; the preview draws the widgets without templates.
    if (!(err instanceof StyleError)) throw err;
  }
  return {
    tokens_css_url: `${STUDIO}draft/tokens.css${v}`,
    css_url:
      Array.isArray(draft.manifest.css) && draft.manifest.css.length > 0
        ? `${STUDIO}draft/theme.css${v}`
        : null,
    logo_url: logoUrl ?? null,
    templates,
  };
}

export const card = (title: string, body: Slot): Html =>
  html`<section class="canccu-card canccu-studio-card">
    <h2 class="canccu-card__title">${title}</h2>
    ${body}
  </section>`;

export const actionButton = (
  label: Slot,
  action: Record<string, string | boolean | undefined>,
  variant = "secondary",
): Html =>
  html`<button${attrs({ type: "button", class: `canccu-button canccu-button--${variant}`, ...action })}>${label}</button>`;

/** The root every page script reads its versions from. */
export const root = (state: { draft?: DraftRow | undefined }, body: Slot): Html =>
  html`<div${attrs({ class: "canccu-studio", "data-draft-version": state.draft?.draft_version })}>${body}</div>`;

/** Where the draft stands, in words: no versions, ids or modes (UX audit C2). */
export function status(state: StudioState, viewerId: string | undefined): Html {
  const published = state.current > 0;
  const d = state.draft;
  if (d === undefined) {
    return html`${
      published
        ? "No draft. Screens show the published theme."
        : "No draft. Nothing published yet: screens show the platform's default look."
    }`;
  }
  const who =
    d.updated_by === null
      ? ""
      : ` · last changed by ${d.updated_by === viewerId ? "you" : "another organiser"}`;
  return html`<span class="canccu-badge canccu-badge--plain">Draft</span>
    ${published ? "Changes to the published theme, not published yet" : "Nothing published yet"}${who}`;
}

/** A problem in words: its message, after the file it is in when that is not theme.yaml. */
const said = (p: Problem): string =>
  p.path === undefined || p.path.startsWith("theme.yaml") ? p.message : `${p.path}: ${p.message}`;

/** The token of a profile or theme font no package holds, which "Use the system font" removes. */
function unknownFont(p: Problem): string | undefined {
  return p.code === "reference_unknown"
    ? /^theme\.yaml#\/tokens\/fonts\/([a-z_]+)$/.exec(p.path ?? "")?.[1]
    : undefined;
}

/**
 * The publish check (UX audit C1): the same problems publish refuses with, worded, with the fixes
 * that are one click as buttons; `details` holds the numbers behind it.
 */
export function checkView(problems: readonly Problem[], details: Slot = ""): Html {
  const errors = problems.filter((p) => p.severity === "error");
  const warnings = problems.filter((p) => p.severity !== "error");
  const items = (list: Problem[]): Html =>
    html`<ul class="canccu-studio-problems">
      ${list.map((p) => html`<li>${said(p)}</li>`)}
    </ul>`;
  if (errors.length > 0) {
    const fixes = errors
      .map(unknownFont)
      .filter((t): t is string => t !== undefined)
      .map((token) =>
        actionButton("Use the system font", { "data-action": "font-system", "data-token": token }),
      );
    return notice({
      kind: "down",
      title: "Can't publish yet",
      text: items(errors),
      actions: fixes.length > 0 ? fixes : undefined,
    });
  }
  if (warnings.length > 0) {
    return notice({
      kind: "warn",
      title: `Ready to publish, with ${warnings.length === 1 ? "one thing" : `${warnings.length} things`} to check`,
      text: html`${items(warnings)}${details}`,
    });
  }
  return notice({
    kind: "ok",
    title: "Ready to publish",
    text: html`All text reads clearly on every surface.${details}`,
  });
}

/** A colour as a swatch and its hex; the hex field is the one the form sends. */
export function colourField(o: {
  name: string;
  label: string;
  value: string | undefined;
  /** The swatch's colour while the field is empty. */
  fallback?: string | undefined;
  placeholder?: string;
}): Html {
  const id = `canccu-studio-${o.name.replace(".", "-")}`;
  const swatch = (o.value ?? o.fallback ?? "#000000").slice(0, 7);
  return html`<div class="canccu-field canccu-studio-colour"><label class="canccu-field__label"${attrs({ for: id })}>${o.label}</label><span class="canccu-studio-colour__row"><input${attrs({ class: "canccu-studio-colour__swatch", type: "color", "aria-label": `${o.label}: pick a colour`, "data-hex-for": o.name, value: swatch })}><input${attrs({ class: "canccu-input canccu-studio-colour__hex", name: o.name, pattern: COLOUR_PATTERN, type: "text", id, value: o.value, placeholder: o.placeholder, spellcheck: "false", autocomplete: "off" })}></span></div>`;
}

export const brandOf = (state: { draft?: DraftRow | undefined }): Brand | undefined => {
  const b = state.draft?.manifest.brand;
  return isObject(b) && typeof b.primary === "string" && typeof b.accent === "string"
    ? (b as unknown as Brand)
    : undefined;
};

const chip = (hex: string): Html =>
  html`<svg class="canccu-studio-chip" viewBox="0 0 1 1" aria-hidden="true">
    <rect width="1" height="1" ${attrs({ fill: hex })} />
  </svg>`;

/** The colours the theme ends up with, by name, and what the brand kit shaded and why. */
export function coloursDetails(
  brand: Brand | undefined,
  colors: Record<string, string>,
  open = false,
): Html {
  const notes: Html[] = [];
  if (brand !== undefined) {
    for (const token of generateColors(brand).adjusted) {
      const given = token === "primary" ? brand.primary : brand.accent;
      notes.push(
        html`<li${attrs({ "data-adjusted": token })}>${token === "primary" ? "Primary" : "Accent"}: ${given} is used as ${colors[token]}, so it stands out from the background (3:1).</li>`,
      );
    }
  }
  const text = colors.primary_text ?? "#000000";
  const ratio = contrastRatio(text, colors.primary ?? "#000000").toFixed(1);
  const swatches = Object.entries(COLOUR_NAMES).map(
    ([token, name]) =>
      html`<li class="canccu-studio-swatch" ${attrs({ "data-token": token })}>
        ${chip(colors[token] ?? "#000000")} ${name}
        <span class="canccu-muted canccu-num">${colors[token]}</span>
      </li>`,
  );
  const summary =
    notes.length === 0
      ? "Every colour you picked is used as it is."
      : `${notes.length === 1 ? "One colour was" : `${notes.length} colours were`} adjusted so text reads.`;
  return html`<details class="canccu-studio-details" ${attrs({ open })}>
    <summary>Details</summary>
    <p>${summary} Text on primary uses ${text} (${ratio}:1).</p>
    ${
      notes.length > 0
        ? html`<ul class="canccu-studio-adjusted">
            ${notes}
          </ul>`
        : ""
    }
    <ul class="canccu-studio-swatches">
      ${swatches}
    </ul>
  </details>`;
}
