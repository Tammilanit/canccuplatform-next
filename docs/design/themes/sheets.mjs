// The two board sheets of the Themes pack (#785, plan Part 0): the overview of all eight presets
// in the gallery's order with their schemes, and the effects of the three advanced looks at the
// motion levels none, calm and lively. The screen, hub and phone renders are frames.mjs's documents.
import { GALLERY, pair } from "./data.mjs";
import { pairFaces } from "./frames.mjs";
import { SHEET_CSS } from "./style.mjs";

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const KIND = { dark: "Dark", light: "Light", contrast: "High contrast", accent: "Colour variant" };
const LOOK = { glows: "Glows", gradient: "Gradient", particles: "Particles", waves: "Waves" };
/** The pairs the existing presets' own fonts match, so the overview draws them in their faces. */
const OWN_PAIR = { "level-up": "chakra-exo", terminal: "barlow" };
const RADIUS_PX = { square: 0, soft: 8, round: 16 };

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

const PERIODS = {
  esports: ["Still. The slab boxes, tabs and the Live lower third stay.", "Still: the sheen waits for lively.", "A light sheen crosses the countdown once every 12 s."],
  synthwave: ["Still: the grid and the sun stand.", "The grid scrolls one cell every 20 s.", "One cell every 8 s; at party every 4 s."],
  arcade: ["Still: scanlines and the vignette only.", "Still: the roll band waits for lively.", "A faint roll band moves down once every 9 s."],
};

/** Sheet 06: each advanced look's hero at none, calm and lively, frozen 1.2 s into its motion. */
export function effects() {
  const rows = GALLERY.filter((p) => p.css).map((p) =>
    `<div><h2>${esc(p.name)}</h2><p>Motion style ${p.pack}</p></div>` +
    ["none", "calm", "lively"].map((lvl, i) => `<div><div class="t-pack-frame"><iframe src="fx-${p.id}-${lvl}.html" title="${p.name} at ${lvl}"></iframe></div><p>${esc(PERIODS[p.id][i])}</p></div>`).join(""),
  );
  const head = `<div></div>${["None", "Calm", "Lively"].map((l) => `<div class="t-pack-col">${l}</div>`).join("")}`;
  return page("Effects", "", `<h1>Screen effects at each motion level</h1><p class="t-pack-lede">The level is the screen zone's (Screen settings); under reduced motion the screen draws none. Effects move only by transform and opacity, sit behind every box, and never repeat faster than once a second.</p><div class="t-pack-effects">${head}${rows.join("")}</div>`);
}
