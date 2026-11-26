// Sheet 6 of the pack (#784): how the screen's living background looks, and what the preview's
// chips change. The engine (hype, game art layer, daylight, particles) is #787's stage package;
// this sheet is what #784's controls and preview let the organiser see and set.
import { PRESETS } from "./data.mjs";
import { icon, screen } from "./parts.mjs";

const SUNSET = PRESETS[2];
const K = SUNSET.schemes[0].colors;
const W = 300;

const fig = (caption, o) => `<figure>${screen(K, { width: W, fonts: SUNSET.fonts, radius: SUNSET.radius, logo: { plate: "light" }, ...o })}<figcaption>${caption}</figcaption></figure>`;
const arrow = `<span class="lane__arrow" aria-hidden="true">${icon("right")}</span>`;
const lane = (title, text, figs) => `<section class="lane"><h2>${title}</h2><p>${text}</p><div class="lane__row">${figs.join(arrow)}</div></section>`;

export function backgroundAlive() {
  return `<main class="canccu-main canccu-main--wide" style="padding:2rem">
  <div class="canccu-pagehead"><div><h1 class="canccu-pagehead__title">The screen background is alive</h1>
  <p class="canccu-pagehead__desc">Level up · Sunset. In Make it yours the organiser picks the looks and the three switches; the preview's chips (How busy, Time of day) show each change before it is published.</p></div></div>
  ${lane("The cycle of looks", "Every few minutes the background crossfades, slowly, to another of the looks left on, picked at random. Calm, never busy.", [fig("Glows", { backdrop: "glows" }), fig("Gradient", { backdrop: "gradient" }), fig("Particles", { backdrop: "particles" })])}
  ${lane("More life when something big is near", "The hype drives the particles and the glow: quiet → building → live. The picture shows the Particles look.", [fig("Quiet", { backdrop: "particles", scene: "quiet" }), fig("Building", { backdrop: "particles", scene: "building" }), fig("Live", { backdrop: "particles", scene: "live" })])}
  ${lane("Follow the time of day", "A warmer light in the morning and a darker, quieter one late at night.", [fig("Morning", { backdrop: "glows", daypart: "morning" }), fig("Day", { backdrop: "glows" }), fig("Late night", { backdrop: "glows", daypart: "late", scene: "quiet" })])}
  ${lane("Show the game's art when a game is on", "While a game is building or live, its art replaces the cycle. When the game is over, the cycle comes back.", [fig("No game: the cycle", { backdrop: "gradient" }), fig("A game is building: its art", { backdrop: "art", scene: "building" }), fig("The game is live: its art", { backdrop: "art", scene: "live" })])}
  <div class="canccu-notice canccu-notice--info" role="status" style="max-width:60rem">${icon("info")}<div class="canccu-notice__body"><p class="canccu-notice__title">How much it moves follows how active the screen is</p><p>The level of a screen zone (still, calm, lively, party) is set in Screen settings and is the ceiling. The screen goes from calm up to it by itself as the hype grows (quiet, building, live). Quiet hours keep it at calm. The theme does not set the level: it only sets the motion style (Standard, Broadcast, Arcade) and the countdown's look.</p></div></div>
  </main>`;
}
