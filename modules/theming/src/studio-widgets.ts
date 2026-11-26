/**
 * Advanced's parts beyond the tokens (plan issue-784 D8, D15, D16; pack sheet 4): own fonts, the
 * screen's own picture, box looks and the editor of the CSS and the templates. Each saves through
 * `PATCH …/draft/parts` and the file upload (static/studio-advanced.js); the editor checks as you
 * type through `POST …/draft/check` (static/studio-editor.js).
 */
import type { SqlClient } from "@canccu/kit";
import { attrs, html, icon } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { isObject, list } from "./checks.js";
import type { DraftRow } from "./drafts.js";
import type { FileStore } from "./files.js";
import { STUDIO, brandOf, fileDrop } from "./studio-views.js";
import type { StudioState } from "./studio-views.js";

export interface Editing {
  path: string;
  text: string;
  /** Whether theme.yaml already names the file; saving a new one names it. */
  listed: boolean;
  /** A new box look: the type it is made for and its name under `templates`. */
  widget?: string;
  name?: string;
}

export interface AdvancedPage {
  editing: Editing;
  pictureUrl: string | undefined;
}

/** The boxes a theme's layouts place, in words; another type reads as its own name. */
const BOXES: Record<string, string> = {
  agenda_now: "Now on",
  announcements: "Announcements",
  clock: "Clock",
  countdown: "Countdown",
  food_status: "Food",
  hot_game: "Hot game",
  leaderboard: "Leaderboard",
  qr: "Hub code",
  ticker: "Ticker",
};
const words = (name: string): string => {
  const plain = name.replaceAll(/[_-]+/g, " ").trim();
  return plain.charAt(0).toUpperCase() + plain.slice(1);
};
const boxName = (type: string): string => BOXES[type] ?? words(type);

const LICENCES: [string, string][] = [
  ["OFL-1.1", "SIL Open Font License"],
  ["Apache-2.0", "Apache 2.0"],
  ["MIT", "MIT"],
  ["UFL-1.0", "Ubuntu Font Licence"],
];

type Templates = Record<string, { widget: string; file: string }>;
const templatesOf = (d: DraftRow): Templates =>
  (isObject(d.manifest.templates) ? d.manifest.templates : {}) as Templates;
const cssOf = (d: DraftRow): string[] =>
  list(d.manifest.css).filter((p): p is string => typeof p === "string");

/** Each widget type the layouts place, with the look its first box uses. */
function placed(d: DraftRow): Map<string, string> {
  const out = new Map<string, string>();
  for (const layout of list(d.manifest.layouts)) {
    if (!isObject(layout)) continue;
    for (const region of list(layout.regions)) {
      if (!isObject(region)) continue;
      for (const w of list(region.widgets)) {
        if (!isObject(w) || typeof w.widget !== "string") continue;
        if (w.widget === "logo" || w.widget === "embed" || out.has(w.widget)) continue;
        out.set(w.widget, typeof w.template === "string" ? w.template : "");
      }
    }
  }
  return out;
}

/** The fonts the theme holds, and the way to add one: the WOFF2 file and its licence. */
export function ownFontsView(d: DraftRow, families: string[]): Html {
  const held =
    families.length === 0
      ? html`<p class="canccu-small canccu-muted">No fonts of your own yet.</p>`
      : html`<p class="canccu-small">Your fonts: ${families.join(", ")}</p>`;
  // prettier-ignore
  const licences = LICENCES.map(([id, label], i) => html`<label class="canccu-studio-segment"><input${attrs({ type: "radio", name: "licence", value: id, checked: i === 0 })}>${label}</label>`);
  return html`<div class="canccu-studio-own">
    ${held}
    <details class="canccu-studio-add">
      <summary class="canccu-button canccu-button--secondary">${icon("plus")}Add a font</summary>
      <form
        class="canccu-studio-form"
        data-action="font-add"
        ${attrs({ "data-fonts": JSON.stringify(list(d.manifest.fonts)) })}
      >
        ${fileDrop({ id: "canccu-studio-font-file", name: "font_file", label: "The font", accept: ".woff2,font/woff2", title: "Choose a WOFF2 file", hint: "Its name in the lists comes from the file's name.", required: true })}
        ${fileDrop({ id: "canccu-studio-licence-file", name: "licence_file", label: "Its licence", accept: ".txt,.md,text/plain", title: "Choose the licence text", hint: "The licence file that came with the font.", required: true })}
        <fieldset class="canccu-field canccu-studio-choice">
          <legend class="canccu-field__label">The licence is</legend>
          <span class="canccu-studio-segments">${licences}</span>
        </fieldset>
        <button class="canccu-button canccu-button--primary" type="submit">Add the font</button>
      </form>
    </details>
  </div>`;
}

/**
 * A video over the picture (D19), which is its poster: shown only once there is a picture, and
 * the one in use is named on the form so a new one replaces it only once stored (studio-advanced.js).
 */
function videoView(own: boolean, video: unknown): Html {
  if (!own) {
    return html`<p class="canccu-small canccu-muted">
      To play a video behind the boxes, add your picture first: it shows while the screen is calm.
    </p>`;
  }
  const playing = typeof video === "string";
  // prettier-ignore
  return html`<form${attrs({ class: "canccu-studio-form", "data-action": "backdrop-video", "data-video": playing ? video : undefined })}>
      ${fileDrop({ id: "canccu-studio-video", name: "video_file", label: playing ? "Replace the video" : "A video over the picture", accept: ".mp4,.webm,video/mp4,video/webm", title: "Choose a video", hint: "MP4 or WebM, up to 20 MB, played without sound. It plays when the screen is lively; when it is calm, and for viewers who reduce motion, your picture shows.", required: true })}
      <span class="canccu-studio-row"><button class="canccu-button canccu-button--secondary" type="submit">Use the video</button>${playing ? html`<button${attrs({ type: "button", class: "canccu-button canccu-button--ghost", "data-action": "backdrop-video-off", "data-video": video })}>No video</button>` : ""}</span>
    </form>`;
}

/** Behind the boxes (D8): the looks cycle, or the organiser's own picture in its place. */
export function backdropView(state: StudioState, d: DraftRow, url: string | undefined): Html {
  const brand = isObject(d.manifest.brand) ? d.manifest.brand : {};
  const image = isObject(brand.backdrop) ? brand.backdrop.image : undefined;
  const video = isObject(brand.backdrop) ? brand.backdrop.video : undefined;
  const own = typeof image === "string";
  if (brandOf(state) === undefined) {
    return html`<p class="canccu-small canccu-muted">
      Behind the boxes: set the colours in <a href="${STUDIO}yours">Make it yours</a> first.
    </p>`;
  }
  const cycle = own
    ? html`<button type="button" class="canccu-studio-segment" data-action="backdrop-cycle">
        The looks cycle
      </button>`
    : html`<span class="canccu-studio-segment" aria-current="true">The looks cycle</span>`;
  return html`<fieldset class="canccu-field canccu-studio-choice canccu-studio-behind">
    <legend class="canccu-field__label">Behind the boxes</legend>
    <span class="canccu-studio-segments"
      >${cycle}<span
        class="canccu-studio-segment"
        ${attrs({ "aria-current": own ? "true" : undefined })}
        >Your picture</span
      ></span
    >
    <form class="canccu-studio-form" data-action="backdrop-image">
      ${fileDrop({ id: "canccu-studio-backdrop", name: "backdrop_file", label: own ? "Replace the picture" : "Your picture", accept: ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp", title: "Choose a picture", hint: "It replaces the cycle of looks, dimmed so text stays readable. The cycle, the game's art, the time of day and the hype are set in Make it yours.", image: own ? url : undefined, required: true })}
      <button class="canccu-button canccu-button--secondary" type="submit">Use the picture</button>
    </form>
    ${videoView(own, video)}
  </fieldset>`;
}

/** Box looks (D16): each box the layouts place uses the platform's look or one made for it. */
export function looksView(d: DraftRow): Html {
  const boxes = placed(d);
  const templates = templatesOf(d);
  const body =
    boxes.size === 0
      ? html`<p class="canccu-small canccu-muted">
          This theme places no boxes of its own: the screens use the layouts of Screen settings. A
          theme with its own layouts lists its boxes here.
        </p>`
      : html`<ul class="canccu-studio-looks-list">
            ${[...boxes].map(([type, chosen]) => {
              const mine = Object.entries(templates).filter(([, t]) => t.widget === type);
              const file = templates[chosen]?.file;
              // prettier-ignore
              return html`<li class="canccu-studio-box"><form class="canccu-studio-box__form" data-action="look" ${attrs({ "data-type": type })}><label class="canccu-studio-box__name"${attrs({ for: `canccu-studio-look-${type}` })}>${boxName(type)}</label><select${attrs({ class: "canccu-input", id: `canccu-studio-look-${type}`, name: `look.${type}` })}><option${attrs({ value: "", selected: chosen === "" })}>Platform look</option>${mine.map(([name]) => html`<option${attrs({ value: name, selected: name === chosen })}>${words(name)} (your look)</option>`)}</select>${file === undefined ? "" : html`<a class="canccu-small"${attrs({ href: `${STUDIO}advanced?edit=${encodeURIComponent(file)}#canccu-studio-editor` })}>Change</a>`}</form></li>`;
            })}
          </ul>
          <form class="canccu-studio-row" method="get" action="${STUDIO}advanced">
            <label class="canccu-small" for="canccu-studio-new-look">New look for</label>
            <select class="canccu-input" id="canccu-studio-new-look" name="new">
              ${[...boxes.keys()].map((t) => html`<option${attrs({ value: t })}>${boxName(t)}</option>`)}
            </select>
            <button class="canccu-button canccu-button--secondary" type="submit">
              ${icon("plus")}New look for a box
            </button>
          </form>`;
  return html`<section class="canccu-studio-section" id="canccu-studio-looks">
    <h2 class="canccu-card__title">Box looks</h2>
    <p class="canccu-card__desc">
      Each box on the screen can use the platform's look or one of yours.
    </p>
    ${body}
  </section>`;
}

/**
 * The editor (D15): a file of the theme, its lines numbered and checked as you type. The HTML
 * parser drops one line break right after `<textarea>`, so the page writes one there: a file's
 * own leading empty line then survives.
 */
export function editorView(d: DraftRow, e: Editing): Html {
  const files = [...cssOf(d), ...Object.values(templatesOf(d)).map((t) => t.file)];
  const chips = [...new Set(e.listed ? files : [...files, e.path])].map(
    (path) =>
      // prettier-ignore
      html`<a${attrs({ class: "canccu-studio-segment", href: `${STUDIO}advanced?edit=${encodeURIComponent(path)}#canccu-studio-editor`, "aria-current": path === e.path ? "true" : undefined })}>${path.slice(path.indexOf("/") + 1)}</a>`,
  );
  const lines = e.text.split("\n").length;
  const template = e.path.startsWith("templates/");
  // prettier-ignore
  return html`<section class="canccu-studio-section" id="canccu-studio-editor">
    <h2 class="canccu-card__title">${template ? "Your box look" : "Your CSS"}</h2>
    <p class="canccu-card__desc">For the last details. Checked as you type; nothing unsafe can reach your pages.</p>
    ${chips.length > 1 ? html`<nav class="canccu-studio-segments" aria-label="Files">${chips}</nav>` : ""}
    <form${attrs({ class: "canccu-studio-form canccu-studio-editor", "data-action": "editor", "data-path": e.path, "data-listed": e.listed ? "1" : undefined, "data-css": JSON.stringify(cssOf(d)), "data-widget": e.widget, "data-name": e.name })}>
      <div class="canccu-studio-editor__box"><ol class="canccu-studio-editor__gutter" aria-hidden="true">${Array.from({ length: lines }, () => html`<li></li>`)}</ol><textarea${attrs({ class: "canccu-studio-editor__text", name: "text", "aria-label": template ? "The box look's template" : "The theme's CSS", spellcheck: "false", autocomplete: "off", wrap: "off", rows: Math.max(10, Math.min(lines + 1, 30)) })}>
${e.text}</textarea></div>
      <ul class="canccu-studio-editor__problems" aria-live="polite"></ul>
      <p class="canccu-studio-row"><span class="canccu-small canccu-muted canccu-studio-editor__state">${icon("check")}Checked as you type</span><button class="canccu-button canccu-button--primary" type="submit">${template ? "Save the look" : "Save CSS"}</button></p>
    </form>
  </section>`;
}

async function draftText(c: SqlClient, files: FileStore, path: string): Promise<string> {
  const { rows } = await c.query(
    `SELECT file FROM theming_package_files WHERE owner = 'draft' AND path = $1`,
    [path],
  );
  const file = (rows[0] as { file: string | null } | undefined)?.file;
  const bytes = file === undefined || file === null ? undefined : await files.read(file);
  return bytes === undefined ? "" : bytes.toString("utf8");
}

const unused = (taken: (x: string) => boolean, base: string): string => {
  let n = 1;
  while (taken(n === 1 ? base : `${base}-${n}`)) n += 1;
  return n === 1 ? base : `${base}-${n}`;
};

/** A template name's most characters (theme.schema.json, `name`). */
const NAME_MAX = 32;

/**
 * A free template name for a new look of `type`: `<type>_look`, then `_look2` and on, the type cut
 * so the whole stays within NAME_MAX, as the upload's PATCH checks it.
 */
function lookName(type: string, taken: (name: string) => boolean): string {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "_look" : `_look${n}`;
    const name = type.slice(0, NAME_MAX - suffix.length) + suffix;
    if (!taken(name)) return name;
  }
}

/**
 * The file the editor shows: `edit` when the theme names it, a new look for the type `fresh` names,
 * else the first CSS file, or a new `css/theme.css`.
 */
export async function editingOf(
  c: SqlClient,
  files: FileStore,
  d: DraftRow,
  q: { edit?: string | undefined; new?: string | undefined },
): Promise<Editing> {
  const css = cssOf(d);
  const templates = templatesOf(d);
  const named = [...css, ...Object.values(templates).map((t) => t.file)];
  if (q.new !== undefined && placed(d).has(q.new)) {
    const files = new Set(named);
    const path = `templates/${unused((p) => files.has(`templates/${p}.mustache`), `${q.new.replaceAll("_", "-")}-look`)}.mustache`;
    const name = lookName(q.new, (n) => Object.hasOwn(templates, n));
    const text = `{{! A look for the ${boxName(q.new).toLowerCase()} box. Its fields are in the screen contract, Widgets. }}\n<div class="t-look">\n  <p class="t-look__title">{{title}}</p>\n</div>\n`;
    return { path, text, listed: false, widget: q.new, name };
  }
  const path = q.edit !== undefined && named.includes(q.edit) ? q.edit : css[0];
  if (path === undefined) return { path: "css/theme.css", text: "", listed: false };
  return { path, text: await draftText(c, files, path), listed: true };
}
