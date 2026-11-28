/**
 * Make it yours's screen background (plan issue-784 D8, issue-785 D11): the looks of the cycle, its
 * switches and how much of it shows through the boxes; and the form's section and choice frames,
 * which the other sections of studio-yours.ts share.
 */
import { attrs, html, icon } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { LOOKS } from "./brand.js";
import type { Backdrop, Brand } from "./brand.js";
import { boxOpacityFor } from "./contrast.js";

export const field = (label: string, body: Html, hint = ""): Html =>
  html`<fieldset class="canccu-field canccu-studio-choice">
    <legend class="canccu-field__label">${label}</legend>
    ${hint === "" ? "" : html`<p class="canccu-field__hint">${hint}</p>`}${body}
  </fieldset>`;

export const section = (title: string, intro: string, body: Html): Html =>
  html`<section class="canccu-studio-section">
    <h2 class="canccu-card__title">${title}</h2>
    ${intro === "" ? "" : html`<p class="canccu-card__desc">${intro}</p>`}${body}
  </section>`;

const LOOK_NAMES: Record<(typeof LOOKS)[number], string> = {
  glows: "Glows",
  gradient: "Gradient",
  particles: "Particles",
  waves: "Waves",
};
const SWITCHES: [keyof Backdrop, string, string][] = [
  [
    "game_art",
    "Show the game's art when a game is on",
    "Its art replaces the cycle while a game is building or live, then the cycle comes back.",
  ],
  ["daylight", "Follow the time of day", "Cooler light in the morning, darker late at night."],
  [
    "hype",
    "More life when something big is near",
    "Particles and glow grow with the hype, and settle after.",
  ],
];

/** What the slider's value reads as: how much of the background shows, not how solid the box is. */
export const seeThrough = (opacity: number): string =>
  opacity >= 1 ? "Solid" : `${Math.round((1 - opacity) * 100)}% see-through`;

/** The screen's boxes over the background (D11): the server raises a value the colours cannot take. */
function boxSlider(brand: Brand | undefined, colors: Readonly<Record<string, string>>): Html {
  // As the screens draw it: raised to what the colours allow (a part the page redraws after a save).
  const value = boxOpacityFor(colors, brand?.box_opacity);
  // prettier-ignore
  const range = html`<input${attrs({ id: "canccu-studio-box-opacity", class: "canccu-studio-control__range", type: "range", name: "box_opacity", min: 0.5, max: 1, step: 0.05, value })}>`;
  return html`<div data-refresh="box-opacity">
    ${field(
      "Box transparency",
      html`<span class="canccu-studio-control__slide"
        >${range}<output class="canccu-small" for="canccu-studio-box-opacity"
          >${seeThrough(value)}</output
        ></span
      >`,
      "How much of the background shows through the screen's boxes. Text always stays readable: where your colours need it, the boxes stay more solid.",
    )}
  </div>`;
}

export function backgroundSection(
  brand: Brand | undefined,
  colors: Readonly<Record<string, string>>,
): Html {
  const b: Backdrop = brand?.backdrop ?? {};
  const looks = new Set(b.looks ?? LOOKS);
  // Prettier would close these lone inputs with an end tag repeating the attributes.
  // prettier-ignore
  const tiles = LOOKS.map((look) => html`<label${attrs({ class: `canccu-studio-look canccu-studio-look--${look}` })}><input${attrs({ type: "checkbox", name: "looks", value: look, checked: looks.has(look) })}><span>${LOOK_NAMES[look]}</span></label>`);
  // prettier-ignore
  const switches = SWITCHES.map(([key, label, hint]) => html`<label class="canccu-studio-switch"><input${attrs({ type: "checkbox", class: "canccu-check", name: key, value: "true", checked: b[key] !== false })}><span><span>${label}</span><span class="canccu-small canccu-muted">${hint}</span></span></label>`);
  // prettier-ignore
  const image = typeof b.image === "string" ? html`<input${attrs({ type: "hidden", name: "backdrop_image", value: b.image })}>` : "";
  return section(
    "Screen background",
    "Alive, never busy: it changes slowly between the looks you leave on, at random, with a long fade every few minutes.",
    html`${field("Looks in the cycle", html`<div class="canccu-studio-looks">${tiles}</div>`)}
      ${switches}${image}${boxSlider(brand, colors)}
      <p class="canccu-small canccu-muted canccu-studio-note">
        ${icon("info")}<span
          >How much the screens move is set for each screen zone in
          <a href="/admin/screen/zones">Screen settings</a>, not here. A screen starts calm and
          rises toward that level as the event gets busy (quiet, building, live), and quiet hours
          keep it calm. Try it with the chips in the preview.</span
        >
      </p>`,
  );
}
