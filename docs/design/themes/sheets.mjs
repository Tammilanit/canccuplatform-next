// The board sheets of the Themes pack (#785, plan Part 0): the overview of all eight presets in the
// gallery's order with their schemes, the effects of the three advanced looks at the four motion
// levels, and the Arcade type comparison. The screen, hub and phone renders are frames.mjs's documents.
import { GALLERY, pair } from "./data.mjs";
import { pairFaces } from "./frames.mjs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { ROOT } from "./data.mjs";
import { SHEET_CSS } from "./style.mjs";

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const KIND = { dark: "Dark", light: "Light", contrast: "High contrast", accent: "Colour variant" };
const LOOK = { glows: "Glows", gradient: "Gradient", particles: "Particles", waves: "Waves", hearth: "Hearth (new): a warm glow from below", sky: "Sky (new): a sky gradient and a soft sun" };
/** The pairs the existing presets' own fonts match, so the overview draws them in their faces. */
const OWN_PAIR = { "level-up": "chakra-exo", terminal: "barlow" };
const RADIUS_PX = { square: 0, soft: 8, round: 16, pill: 40 };

const page = (title, faces, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${faces}\n${SHEET_CSS}</style></head><body>${body}</body></html>`;

function swatch(s, fonts, radius) {
  const k = s.colors;
  return `<div class="t-pack-swatch" style="background:${k.background};--fh:${fonts.h};--fb:${fonts.b};--r:${radius}px">` +
    `<div class="t-pack-swatch__card" style="background:${k.surface};border-color:${k.border};color:${k.text}"><b>Aa</b><span style="color:${k.text_muted}">18:00 Finals</span></div>` +
    `<div class="t-pack-swatch__pills"><i style="background:${k.primary}"></i><i style="background:${k.accent}"></i><i style="background:${k.status_ok}"></i></div>` +
    `<span class="t-pack-swatch__name" style="color:${k.text}">${esc(s.name)}</span></div>`;
}

function fontsOf(p) {
  const id = p.pair ?? OWN_PAIR[p.id];
  if (!id) return { h: "system-ui", b: "system-ui", name: "System font" };
  const fp = pair(id);
  return { h: `"${fp.heading.family}"`, b: `"${fp.body.family}"`, name: `${fp.heading.family} / ${fp.body.family}` };
}

/** Sheet 00: every preset, its feel, what it is made of, and its schemes as small cards. */
export function overview() {
  const faces = [...new Set(GALLERY.map((p) => p.pair ?? OWN_PAIR[p.id]).filter(Boolean))].map(pairFaces).join("\n");
  const cards = GALLERY.map((p) => {
    const f = fontsOf(p);
    const facts = p.existing
      ? [`<li>Today's preset</li>`, `<li>${esc(f.name)}</li>`]
      : [
          `<li class="t-pack-new">New</li>`,
          `<li>${p.mode === "simple" ? "Simple: no CSS" : "Advanced: own CSS"}</li>`,
          `<li>${esc(f.name)}</li>`,
          `<li>Corners: ${p.roundness}</li>`,
          `<li>Boxes: ${Math.round(p.boxOpacity * 100)}% opaque</li>`,
          `<li>Background: ${p.looks.map((l) => LOOK[l]).join(" and ")}</li>`,
          `<li>Motion style: ${p.pack[0].toUpperCase()}${p.pack.slice(1)}</li>`,
          ...p.templates.map((t) => `<li>${esc(t)}</li>`),
        ];
    const radius = p.roundness ? RADIUS_PX[p.roundness] : (p.radius ?? 8);
    return `<article class="t-pack-preset"><h2 style="font-family:${f.h}">${esc(p.name)}</h2><p class="t-pack-feel">${esc(p.feel)}</p>` +
      `<ul class="t-pack-facts">${facts.join("")}</ul>` +
      `<div class="t-pack-schemes">${p.schemes.map((s) => swatch(s, f, radius)).join("")}</div>` +
      `<p class="t-pack-feel">${p.schemes.map((s) => `${esc(s.name)} (${KIND[s.kind]})`).join(" · ")}</p></article>`;
  });
  return page("Presets", faces, `<h1>The eight presets in Pick a look</h1><p class="t-pack-lede">In the gallery's order, from neutral to bold. Each card shows the preset's schemes on their own ground, in the preset's fonts and corners. Every scheme passes the contrast rules.</p><div class="t-pack-presets">${cards.join("")}</div>`);
}

/** What each advanced look's effects sheet shows: the crop of the 1920×1080 screen where the effect
 *  is, each level's frozen moment (a sheen or a band is only on screen for part of its turn), and
 *  its period in words. The clips (--clips) show the motion itself. */
export const LEVELS = ["none", "calm", "lively", "party"];
export const FX = {
  esports: {
    crop: [40, 200, 1230, 560],
    t: { none: 1.2, calm: 1.2, lively: 1.2, party: 0.7 },
    words: ["Still: the slab boxes, tabs and the Live lower third stay.", "Still: the sheen waits for lively.", "A light sheen crosses the countdown once every 12 s.", "The sheen crosses once every 7 s."],
  },
  synthwave: {
    crop: [640, 560, 640, 520],
    t: { none: 1.2, calm: 1.2, lively: 1.2, party: 1.2 },
    words: ["Still: the sun, the band and the grid stand.", "The grid advances one cell every 8 s.", "One cell every 3.5 s.", "One cell every 1.6 s: the fastest."],
  },
  arcade: {
    crop: [0, 40, 900, 500],
    t: { none: 1.2, calm: 1.2, lively: 3, party: 2 },
    words: ["Still: scanlines and the vignette only.", "Still: the roll band waits for lively.", "A faint roll band moves down once every 9 s.", "The roll band moves down once every 6 s."],
  },
};
const CELL = 262;

/** Sheet 06: each advanced look at none, calm, lively and party, cropped to where its effect is. */
export function effects() {
  const rows = GALLERY.filter((p) => p.css).map((p) => {
    const { crop, words } = FX[p.id];
    const scale = CELL / crop[2];
    const cells = LEVELS.map((lvl, i) => `<div><div class="t-pack-frame" style="width:${CELL}px;height:${Math.round(crop[3] * scale)}px"><iframe src="fx-${p.id}-${lvl}.html" title="${esc(p.name)} at ${lvl}" style="transform:scale(${scale});margin:${-crop[1] * scale}px 0 0 ${-crop[0] * scale}px"></iframe></div><p>${esc(words[i])}</p></div>`).join("");
    return `<div><h2>${esc(p.name)}</h2><p>Motion style ${p.pack}.</p></div>${cells}`;
  });
  const head = `<div></div>${LEVELS.map((l) => `<div class="t-pack-col">${l[0].toUpperCase()}${l.slice(1)}</div>`).join("")}`;
  const speeds = [["Calm", 8], ["Lively", 3.5], ["Party", 1.6]].map(([l, s]) => `<div class="t-pack-speed"><span>${l}</span><i style="width:${Math.round(60 / s * 11)}px"></i><b>${(60 / s).toFixed(1)} cells a minute</b></div>`).join("");
  return page("Effects", "", `<h1>Screen effects at each motion level</h1><p class="t-pack-lede">The level is the screen zone's (Screen settings); under reduced motion the screen draws none. Effects move only by transform and opacity and never repeat faster than once a second. Each frame is frozen inside its motion and zoomed on the effect. The three clips that follow this sheet show all four levels moving side by side.</p><div class="t-pack-effects">${head}${rows.join("")}</div><h2 class="t-pack-h2">Synthwave's grid follows the heat</h2><p class="t-pack-lede">It never stops at calm, lively or party, and is still at none and under reduced motion.</p>${speeds}`);
}

const SAMPLES = [
  ["Pixelify Sans", "Today's face: the 2 reads as an S turned over, the PO's finding.", "pixelify-sans-600.woff2", "modules/theming/fonts/pixelify-plex", "woff2", "rejected"],
  ["Press Start 2P", "Titles, digits, ranks. Clear 0–9, very wide, so only for short lines.", "PressStart2P-Regular.ttf", "docs/design/themes/fonts/press-jersey", "truetype", "recommended for titles and digits"],
  ["Jersey 10", "Every line of text. Narrow, round and readable in a sentence.", "Jersey10-Regular.ttf", "docs/design/themes/fonts/press-jersey", "truetype", "recommended for text"],
  ["Silkscreen", "Capitals only in effect and thin; its small caps tire in a long line.", "Silkscreen-Regular.ttf", "docs/design/themes/fonts/silkscreen", "truetype", "not chosen"],
];

/** Sheet 07: the pixel faces side by side with the digits and a sample line, and the recommendation. */
export function fonts() {
  const faces = SAMPLES.map(([fam, , file, dir, fmt]) => `@font-face{font-family:"${fam}";src:url(${pathToFileURL(join(ROOT, dir, file)).href}) format("${fmt}")}`).join("\n");
  const rows = SAMPLES.map(([fam, why, , , , verdict]) => {
    const big = fam === "Jersey 10" ? 56 : fam === "Press Start 2P" ? 34 : 40;
    return `<article class="t-pack-font ${verdict.startsWith("recommended") ? "t-pack-font--yes" : ""}"><header><h2>${fam}</h2><b>${verdict}</b></header><p class="t-pack-feel">${why}</p>` +
      `<div class="t-pack-digits" style="font-family:'${fam}';font-size:${big}px">0123456789</div>` +
      `<div class="t-pack-sample" style="font-family:'${fam}';font-size:${Math.round(big * 0.7)}px">Pizza order open · closes 19:30<br>1ST Night Owls ...... 2480</div></article>`;
  });
  return page("Arcade type", faces, `<h1>Arcade: the pixel faces, side by side</h1><p class="t-pack-lede"><b>Recommended:</b> Press Start 2P for titles, digits and ranks, and Jersey 10 for every line of text, so the whole screen is one pixel family. Sizes are drawn as on a 1080p screen: 27 px and up.</p>${rows.join("")}`);
}
