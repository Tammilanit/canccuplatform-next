/**
 * Advanced (plan issue-784 D14–D16, D22; pack sheet 4): every token as a control, in groups by
 * what it affects, each with its ⓘ; own fonts and the screen's own picture; box looks; the CSS and
 * template editor. The controls belong to one form (`form` attribute), which static/studio.js saves
 * 400 ms after the last change and static/studio-advanced.js posts to the frames as it changes.
 */
import { FONT_TOKENS, attrs, html, icon, motionStyleOf } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { isObject, list } from "./checks.js";
import type { DraftRow } from "./drafts.js";
import { FONT_PAIRS } from "./font-pairs.js";
import { ADVANCED_CONTROLS, GROUPS, pxOf } from "./studio-controls.js";
import type { Control, ControlGroup } from "./studio-controls.js";
import { STUDIO, brandOf, card, checkView } from "./studio-views.js";
import type { StudioState } from "./studio-views.js";
import { backdropView, editorView, looksView, ownFontsView } from "./studio-widgets.js";
import type { AdvancedPage } from "./studio-widgets.js";
import { readsWell, resetView } from "./studio-yours.js";
import { fillTokens, fontValue, manifestTokens } from "./tokens.js";

const FORM = "canccu-studio-tokens";
const GENERIC: Record<string, [string, string]> = {
  mono: ["ui-monospace", "System fixed-width font"],
};

/** The pairs of colours whose text must read (the "Reads well" badge, 4.5:1). */
const READS_ON: Record<string, [string, string]> = {
  background: ["text", "background"],
  surface: ["text", "surface"],
  text_muted: ["text_muted", "background"],
  primary: ["primary_text", "primary"],
};

/** The ⓘ beside a label: its words open in place, no script needed. */
const tip = (label: string, hint: string): Html =>
  html`<details class="canccu-studio-tip">
    <summary${attrs({ "aria-label": `About ${label}` })}>${icon("info")}</summary>
    <p class="canccu-studio-tip__text"><strong>${label}</strong><br />${hint}</p>
  </details>`;

const head = (c: Control, id: string): Html =>
  html`<span class="canccu-studio-control__head"
    ><label class="canccu-studio-control__label" ${attrs({ for: id })}>${c.label}</label
    >${tip(c.label, c.hint)}<span class="canccu-small canccu-muted canccu-studio-control__what"
      >${c.what}</span
    ></span
  >`;

function badge(name: string, colors: Record<string, string>): Html | string {
  const pair = READS_ON[name];
  if (pair === undefined) return "";
  const [text, ground] = pair;
  const ok = readsWell(colors[text] ?? "#000000", colors[ground] ?? "#ffffff");
  return html`<span${attrs({ "data-refresh": `reads-${name}` })}
    >${
      ok
        ? html`<span class="canccu-badge canccu-badge--ok">${icon("check")}Reads well</span>`
        : html`<span class="canccu-badge canccu-badge--degraded">Hard to read</span>`
    }</span
  >`;
}

interface Values {
  colors: Record<string, string>;
  sizes: Record<string, string>;
  fonts: Record<string, unknown>;
  style: Record<string, string>;
  families: string[];
  pair: { heading: string; body: string } | undefined;
}

function valuesOf(d: DraftRow): Values {
  const m = d.manifest;
  const given = isObject(m.tokens) ? m.tokens : {};
  const brand = isObject(m.brand) ? m.brand : {};
  const pair = typeof brand.font_pair === "string" ? FONT_PAIRS.get(brand.font_pair) : undefined;
  return {
    colors: fillTokens(given).colors,
    sizes: manifestTokens(m).sizes,
    fonts: isObject(given.fonts) ? given.fonts : {},
    style: motionStyleOf(given.motion_style) as unknown as Record<string, string>,
    families: [
      ...new Set(
        list(m.fonts)
          .map((f) => (isObject(f) && typeof f.family === "string" ? f.family : undefined))
          .filter((f): f is string => f !== undefined),
      ),
    ],
    pair: pair === undefined ? undefined : { heading: pair.heading.family, body: pair.body.family },
  };
}

function fontOptions(name: string, v: Values): Html[] {
  const chosen = typeof v.fonts[name] === "string" ? v.fonts[name] : "";
  const fromPair = name === "body" ? v.pair?.body : name === "mono" ? undefined : v.pair?.heading;
  const options: [string, string, string][] = [
    fromPair === undefined
      ? ["", "Platform font", fontValue(name, FONT_TOKENS[name as keyof typeof FONT_TOKENS])]
      : ["", `From the font pair: ${fromPair}`, fontValue(name, fromPair)],
  ];
  // The system font is the platform's own unless a pair stands in for it.
  const generic = GENERIC[name] ?? ["system-ui", "System font"];
  if (fromPair !== undefined) options.push([generic[0], generic[1], fontValue(name, generic[0])]);
  for (const family of new Set([...v.families, ...(chosen === "" ? [] : [chosen])])) {
    if (options.some(([value]) => value === family)) continue;
    options.push([family, family, fontValue(name, family)]);
  }
  return options.map(
    ([value, label, stack]) =>
      html`<option${attrs({ value, "data-stack": stack, selected: value === chosen })}>${label}</option>`,
  );
}

function control(c: Control, v: Values): Html {
  const [group = "", name = ""] = c.token.split(".");
  const id = `canccu-studio-${group}-${name}`;
  const common = { form: FORM, name: c.token, id, "data-var": c.cssVar };
  if (c.control === "colour") {
    const value = (v.colors[name] ?? "#000000").slice(0, 7);
    // prettier-ignore
    return html`<div class="canccu-studio-control canccu-studio-control--colour"><input${attrs({ ...common, class: "canccu-studio-control__swatch", type: "color", value })}>${head(c, id)}${badge(name, v.colors)}</div>`;
  }
  if (c.control === "font") {
    // prettier-ignore
    return html`<div class="canccu-studio-control">${head(c, id)}<select${attrs({ ...common, class: "canccu-input canccu-studio-control__font" })}>${fontOptions(name, v)}</select></div>`;
  }
  if (c.control === "slider") {
    const [min, max] = c.range ?? [0, 0];
    const px = Math.min(max, Math.max(min, Math.round(pxOf(v.sizes[name]) ?? min)));
    // prettier-ignore
    return html`<div class="canccu-studio-control canccu-studio-control--slider">${head(c, id)}<span class="canccu-studio-control__slide"><input${attrs({ ...common, class: "canccu-studio-control__range", type: "range", min, max, step: c.step, value: px, "data-unit": "px" })}><output${attrs({ for: id, class: "canccu-small" })}>${px} px</output></span></div>`;
  }
  const chosen = v.style[name];
  // prettier-ignore
  return html`<fieldset class="canccu-studio-control canccu-studio-control--chips"><legend class="canccu-studio-control__head"><span class="canccu-studio-control__label">${c.label}</span>${tip(c.label, c.hint)}<span class="canccu-small canccu-muted canccu-studio-control__what">${c.what}</span></legend><span class="canccu-studio-segments">${(c.options ?? []).map(([value, label]) => html`<label class="canccu-studio-segment"><input${attrs({ form: FORM, type: "radio", name: c.token, value, checked: value === chosen, "data-var": c.cssVar })}>${label}</label>`)}</span></fieldset>`;
}

const groupId = (g: string): string => `canccu-studio-g-${g}`;

function groupView(
  g: ControlGroup,
  title: string,
  intro: string,
  v: Values,
  extra: Html | string,
): Html {
  const controls = ADVANCED_CONTROLS.filter((c) => c.group === g).map((c) => control(c, v));
  return html`<section class="canccu-studio-section" ${attrs({ id: groupId(g) })}>
    <h2 class="canccu-card__title">${title}</h2>
    <p class="canccu-card__desc">${intro}</p>
    <div class="canccu-studio-controls-list">${controls}</div>
    ${extra}
  </section>`;
}

const motionNote = html`<p class="canccu-small canccu-muted canccu-studio-note">
  ${icon("info")}<span
    >How much the screens move (still, calm, lively, party) is set for each screen zone in
    <a href="/admin/screen/zones">Screen settings</a>. A screen rises from calm toward that level as
    the event gets busy; quiet hours keep it calm.</span
  >
</p>`;

/** Back to simple mode: the way out of Advanced, once the draft has a brand to make colours from. */
function simpleView(state: StudioState, d: DraftRow): Html | string {
  if (d.manifest.mode !== "advanced") return "";
  if (brandOf(state) === undefined) {
    return card(
      "Back to simple mode",
      html`<p>
        Save the brand kit first: simple mode makes its colours from the brand's two colours.
        <a href="${STUDIO}yours">Make it yours</a>
      </p>`,
    );
  }
  return card(
    "Back to simple mode",
    html`<details class="canccu-studio-confirm">
      <summary>Remove the advanced parts</summary>
      <form class="canccu-studio-form" data-action="simple">
        <p>
          This removes the draft's CSS, fonts, templates and embeds, and its font and size tokens.
          Images and layouts stay; the colours are made again from the brand kit.
        </p>
        <button class="canccu-button canccu-button--danger" type="submit">
          Remove them and go back to simple
        </button>
      </form>
    </details>`,
  );
}

export function advancedView(state: StudioState, d: DraftRow, page: AdvancedPage): Html {
  const v = valuesOf(d);
  const nav = [
    ...GROUPS.map(([g, title]) => [groupId(g), title] as const),
    ["canccu-studio-looks", "Box looks"] as const,
    ["canccu-studio-editor", "Your CSS"] as const,
  ];
  const extras: Partial<Record<ControlGroup, Html>> = {
    type: ownFontsView(d, v.families),
    screen: backdropView(state, d, page.pictureUrl),
    motion: motionNote,
  };
  return html`<div class="canccu-studio-controls canccu-studio-advanced">
    <p class="canccu-studio-intro">
      ${icon("info")}<span
        >Everything, one control each. Tap the ${icon("info")} beside a setting to read what it
        changes. Changes are saved as you make them.</span
      >
    </p>
    <nav class="canccu-studio-segments canccu-studio-jump" aria-label="Groups">
      ${nav.map(([id, title]) => html`<a class="canccu-studio-segment" href="#${id}">${title}</a>`)}
    </nav>
    <form id="${FORM}" class="canccu-studio-form" data-action="tokens" data-autosave></form>
    ${GROUPS.map(([g, title, intro]) => groupView(g, title, intro, v, extras[g] ?? ""))}
    ${looksView(d)} ${editorView(d, page.editing)}
    <div data-refresh="check">${checkView(state.problems)}</div>
    ${resetView(state)} ${simpleView(state, d)}
  </div>`;
}
