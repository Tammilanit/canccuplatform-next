/** The advanced page and the history page (plan issue-185 D8): package, tokens, files, restore. */
import { COLOR_TOKENS, FONT_TOKENS, SIZE_TOKENS, attrs, html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { DraftRow } from "./drafts.js";
import { MOTION_STYLE, fillTokens, motionStyleOf } from "./tokens.js";
import type { PartialTokens } from "./tokens.js";
import {
  COLOUR_NAMES,
  STUDIO,
  actionButton,
  brandOf,
  card,
  checkView,
  colourField,
  fileDrop,
  root,
} from "./studio-views.js";
import type { StudioState } from "./studio-views.js";

const STYLE_LABELS: Record<keyof typeof MOTION_STYLE, string> = {
  speed: "Speed",
  intensity: "Intensity",
  spotlight: "Spotlight",
  pack: "Motion pack",
};
const words = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");

/**
 * The `motion_style` token's four choices (contracts/theming.md, Motion vocabulary). Like
 * `motion`, they are no styling: saving them keeps a simple theme simple.
 */
function motionStyleFields(given: unknown): Html {
  const style = motionStyleOf(given);
  const fields = (Object.keys(MOTION_STYLE) as (keyof typeof MOTION_STYLE)[]).map((field) => {
    const id = `canccu-studio-motion-${field}`;
    const options = MOTION_STYLE[field].map(
      (v) => html`<option${attrs({ value: v, selected: v === style[field] })}>${words(v)}</option>`,
    );
    return html`<div class="canccu-field"><label class="canccu-field__label"${attrs({ for: id })}>${STYLE_LABELS[field]}</label><select${attrs({ class: "canccu-input", id, name: `motion_style.${field}` })}>${options}</select></div>`;
  });
  return html`<fieldset class="canccu-studio-tokens">
    <legend>Motion style</legend>
    ${fields}
    <p class="canccu-field__hint">
      How the screens' effects feel. The event and each zone choose how lively they are.
    </p>
  </fieldset>`;
}

function tokensForm(draft: DraftRow): Html {
  const given = draft.manifest.tokens as
    (PartialTokens & { motion?: unknown; motion_style?: unknown }) | undefined;
  const tokens = fillTokens(given ?? {});
  const groups: [keyof typeof tokens, string, object][] = [
    ["fonts", "Fonts", FONT_TOKENS],
    ["sizes", "Sizes", SIZE_TOKENS],
  ];
  // Colours as swatches with their hex, by name (UX audit C5).
  const colours = Object.keys(COLOR_TOKENS).map((name) =>
    colourField({
      name: `colors.${name}`,
      label: COLOUR_NAMES[name as keyof typeof COLOUR_NAMES],
      value: tokens.colors[name],
    }),
  );
  const fieldsets = groups.map(([group, label, names]) => {
    const fields = Object.keys(names).map((name) => {
      const id = `canccu-studio-${group}-${name}`;
      return html`<div class="canccu-field"><label class="canccu-field__label"${attrs({ for: id })}><code>${name}</code></label><input${attrs({ class: "canccu-input", type: "text", id, name: `${group}.${name}`, value: tokens[group][name] })}></div>`;
    });
    return html`<fieldset class="canccu-studio-tokens">
      <legend>${label}</legend>
      ${fields}
    </fieldset>`;
  });
  const motion = typeof given?.motion === "string" ? given.motion : "moderate";
  const motions = ["moderate", "calm", "none"].map(
    (m) => html`<option${attrs({ value: m, selected: m === motion })}>${m}</option>`,
  );
  return card(
    "Tokens",
    html`<form class="canccu-studio-form" data-action="tokens">
      <fieldset class="canccu-studio-tokens">
        <legend>Colours</legend>
        <div class="canccu-studio-colours">${colours}</div>
      </fieldset>
      ${fieldsets}
      <div class="canccu-field">
        <label class="canccu-field__label" for="canccu-studio-motion">Motion</label
        ><select class="canccu-input" id="canccu-studio-motion" name="motion">
          ${motions}
        </select>
      </div>
      ${motionStyleFields(given?.motion_style)}
      <p class="canccu-field__hint">
        Only the tokens you change are saved. Changing a colour, font or size makes the theme
        advanced.
      </p>
      <button class="canccu-button canccu-button--primary" type="submit">Save tokens</button>
    </form>`,
  );
}

function filesView(draft: DraftRow): Html {
  if (draft.files.length === 0) return html`<p>The draft holds no files.</p>`;
  const rows = draft.files.map(
    (f) => html`<li><code>${f.path}</code> ${Math.ceil(f.bytes / 1024)} KB</li>`,
  );
  return html`<ul class="canccu-studio-files">
    ${rows}
  </ul>`;
}

export function advancedView(state: StudioState): Html {
  const d = state.draft;
  const upload = card(
    "Package",
    html`<form class="canccu-studio-form" data-action="package">
      ${fileDrop({
        id: "canccu-studio-package",
        name: "package",
        label: "Theme package (zip)",
        accept: ".zip,application/zip",
        title: "Choose a package",
        hint: "It replaces the draft's whole content: theme.yaml, CSS, fonts, images, templates and embeds. Embeds need the embeds right.",
        required: true,
      })}
      <button class="canccu-button canccu-button--primary" type="submit">Upload package</button>
    </form>`,
  );
  if (d === undefined) return root(state, upload);
  const simple =
    d.manifest.mode !== "advanced"
      ? ""
      : brandOf(state) === undefined
        ? card(
            "Back to simple mode",
            html`<p>
              Save the brand kit first: simple mode makes its colours from the brand's two colours.
              <a href="${STUDIO}">Brand kit</a>
            </p>`,
          )
        : card(
            "Back to simple mode",
            html`<details class="canccu-studio-confirm">
              <summary>Remove the advanced parts</summary>
              <form class="canccu-studio-form" data-action="simple">
                <p>
                  This removes the draft's CSS, fonts, templates and embeds, and its font and size
                  tokens. Images and layouts stay; the colours are made again from the brand kit.
                </p>
                <button class="canccu-button canccu-button--danger" type="submit">
                  Remove them and go back to simple
                </button>
              </form>
            </details>`,
          );
  return root(
    state,
    html`${card("Before publishing", checkView(state.problems))} ${upload}
      ${card("Files", filesView(d))} ${tokensForm(d)} ${simple}
      <p><a href="${STUDIO}">Preview and publish on the brand kit page</a></p>`,
  );
}

interface RevisionSummary {
  revision: number;
  name?: string;
  mode: string;
  published_at: string;
  actor_user_id: string | null;
  restored_from?: number;
  pinned: boolean;
}

/** `list` holds up to `pageSize + 1` rows; the extra one only says that older revisions exist. */
export function historyView(
  list: { current_revision: number; revisions: Record<string, unknown>[] },
  pageSize: number,
  before: number | undefined,
): Html {
  const current = list.current_revision;
  const all = list.revisions as unknown as RevisionSummary[];
  const revisions = all.slice(0, pageSize);
  const rows = revisions.map((r) => {
    const restore =
      r.revision === current
        ? html`<strong>On every screen</strong>`
        : actionButton("Restore", {
            "data-action": "restore",
            "data-revision": String(r.revision),
          });
    return html`<li class="canccu-studio-revision"><span class="canccu-studio-revision__title">Revision ${r.revision}</span> ${r.name ?? ""} · ${r.mode} · <time${attrs({ datetime: r.published_at })}>${r.published_at.slice(0, 16).replace("T", " ")}</time>${r.actor_user_id === null ? "" : ` · ${r.actor_user_id}`}${r.restored_from === undefined ? "" : ` · restored from ${r.restored_from}`}${r.pinned ? html` · <span class="canccu-badge canccu-badge--degraded">Pinned</span>` : ""}
<span class="canccu-studio-row">${restore} <a${attrs({ href: `/api/theming/revisions/${r.revision}/package` })}>Export</a></span></li>`;
  });
  const last = revisions.at(-1);
  const more =
    all.length > pageSize && last !== undefined
      ? html`<p><a${attrs({ href: `${STUDIO}history?before=${last.revision}` })}>Older revisions</a></p>`
      : "";
  const empty =
    before === undefined
      ? html`<p>Nothing published yet: screens show the platform's default look.</p>`
      : html`<p>No older revisions. <a href="${STUDIO}history">Newest revisions</a></p>`;
  return html`<div class="canccu-studio" ${attrs({ "data-current-revision": current })}>
    ${
      revisions.length === 0
        ? empty
        : html`<p>
              Restore publishes a copy of an earlier revision as a new one; history only grows. The
              last 20 revisions are kept, and every pinned one.
            </p>
            <ol class="canccu-studio-revisions">
              ${rows}
            </ol>`
    }${more}
  </div>`;
}
