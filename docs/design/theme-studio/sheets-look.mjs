// Sheets 1–3 of the pack (#784): Pick a look, Make it yours with the logo on a plate, and the
// black logo on a plate in each preset. Each returns the <body> of one sheet at one width.
import { FONT_PAIRS, PRESETS, contrast } from "./data.mjs";
import { LOGO_BLACK, esc, hubPage, icon, logo, phone, previewColumn, screen, shell, stageLook, thumb, vars } from "./parts.mjs";

const DEFAULT = PRESETS[0];
const NIGHT = DEFAULT.schemes[0].colors;
/** The preview column's width at each sheet width (plan D2). */
export const pvWidth = (w) => (w >= 1920 ? 720 : w >= 1280 ? 480 : w - 32);

/** Sheet 1: the gallery. The event's black logo already sits on the plate the check suggested. */
export function pickALook(w) {
  const presets = PRESETS.map((p) => `<section class="preset"><div class="preset__head"><h2 style="font-family:${p.fonts.heading === "system-ui" ? "system-ui" : `'${p.fonts.heading}'`}">${p.name}</h2><span>${p.feel}</span></div>
  <div class="thumbs" style="--thumb:${w >= 1920 ? 180 : w >= 1280 ? 196 : 150}px">${p.schemes.map((s) => thumb(p, s, { plate: "light", chosen: p.id === "level-up" && s.id === "sunset" })).join("")}</div></section>`).join("");
  const chosen = PRESETS[2];
  const body = `<div class="studio"><div>
  <div class="canccu-notice canccu-notice--info" role="status">${icon("info")}<div class="canccu-notice__body"><p class="canccu-notice__title">Pick a look, then make it yours</p><p>One click tries a look in the preview. Your logo and its plate stay whichever you pick.</p></div></div>
  <div style="margin-top:1.5rem">${presets}</div>
  <section class="preset"><div class="preset__head"><h2>Your looks</h2><span>Looks you saved, ready for your next event</span></div>
  <div class="empty-row"><span>Nothing saved yet. When a look is just right, save it from Make it yours and it shows here, also in the next event of your series.</span></div></section>
  <div class="foot"><span class="grow"></span><a class="canccu-button canccu-button--primary" href="#">Make it yours ${icon("right")}</a></div>
  </div>${previewColumn(chosen.schemes[0].colors, { width: pvWidth(w), phone: w < 700, fonts: chosen.fonts, radius: chosen.radius, logo: { plate: "light" } })}</div>`;
  return shell({ tab: "Pick a look", body, k: NIGHT });
}

const plateTile = (k, plate, label, pressed) =>
  `<button class="opt" type="button" aria-pressed="${pressed}"><span class="tile" style="background:${k.background}">${logo(k, { plate, h: 16, pad: 0.2 })}</span>${label}</button>`;
const pill = (label, pressed, ico) => `<button class="pill" type="button" aria-pressed="${pressed}">${ico ? icon(ico) : ""}${label}</button>`;
const sw = (hex, pressed) => `<span class="swatch" style="background:${hex}" aria-pressed="${pressed}" title="${hex}"></span>`;

/** Sheet 2: Make it yours on the Default preset's Night scheme: the plate check fired, Light plate chosen. */
export function makeItYours(w) {
  const k = NIGHT;
  const ratio = contrast("#000000", k.background).toFixed(1);
  const pairs = [`<button class="pair" type="button" aria-pressed="false"><b style="font-family:system-ui">Platform font</b><span style="font-family:system-ui">The device's own</span></button>`]
    .concat(FONT_PAIRS.map((p, i) => `<button class="pair" type="button" aria-pressed="${i === 2}"><b style="font-family:'${p.heading}';font-weight:${p.hw}">${p.mood}</b><span style="font-family:'${p.body}';font-weight:${p.bw}">${p.heading} · ${p.body}</span></button>`))
    .join("");
  // One look of the cycle: a tile drawn the way the stage draws it, ticked when it is in the cycle.
  const look = (label, kind, on) => `<button class="opt opt--multi" type="button" aria-pressed="${on}"><span class="tile tile--wide" style="${stageLook(k, kind)}"></span><span class="tick">${icon("check")}</span>${label}</button>`;
  const toggle = (label, hint, on = true) => `<label class="sw"><input class="canccu-switch" type="checkbox"${on ? " checked" : ""}><b>${label}</b><small>${hint}</small></label>`;
  const body = `<div class="studio"><div>
  <section class="sec"><h2>Logo</h2><p class="hint">Shown on the screens, the hub, the organiser pages and in Discord.</p>
    <div class="logobox"><span class="logobox__ground" style="background:${k.background}"><img src="${LOGO_BLACK}" alt="" style="height:44px"></span>
    <div class="row"><a class="canccu-button canccu-button--secondary" href="#">Replace logo</a></div></div>
    <div class="advice">${icon("warn")}<div><p><b>Your logo is hard to see on this dark background.</b> Only ${ratio}:1 against it, and logos need at least 3:1.</p><a class="canccu-button canccu-button--primary" href="#">Put it on a light plate</a></div></div>
    <span class="lbl">Plate behind the logo</span><div class="row">${plateTile(k, "none", "None", false)}${plateTile(k, "light", "Light", true)}${plateTile(k, "dark", "Dark", false)}${plateTile(k, "surface", "Theme surface", false)}</div>
    <span class="lbl">Shape</span><div class="row">${pill("Rounded", true)}${pill("Circle", false)}</div>
    <span class="lbl">Space around the logo</span><div class="row">${pill("Small", false)}${pill("Medium", true)}${pill("Large", false)}</div></section>
  <section class="sec"><h2>Colours</h2><p class="hint">Pick a colour, or one that goes well with it. Text colours follow, so everything stays readable.</p>
    <div class="colour"><span class="swatch swatch--big" style="background:${k.primary}"></span><div><b>Main colour</b><br><small>Buttons, highlights, the countdown</small></div></div>
    <div class="row" style="margin:-.25rem 0 1rem 4rem"><small style="color:var(--canccu-ink-muted);width:100%">Goes well with</small>${["#3ddcff", "#3d8bff", "#3dffc4", "#ff7a3d", "#5fe1ff"].map((h, i) => sw(h, i === 0)).join("")}</div>
    <div class="colour"><span class="swatch swatch--big" style="background:${k.accent}"></span><div><b>Second colour</b><br><small>Labels, glows on the screens</small></div></div>
    <div class="row" style="margin:-.25rem 0 1rem 4rem"><small style="color:var(--canccu-ink-muted);width:100%">Goes well with</small>${["#b98cff", "#ff8cd9", "#8cffb9", "#ffd166", "#8ca8ff"].map((h, i) => sw(h, i === 0)).join("")}</div>
    <span class="lbl">Light or dark</span><div class="row">${pill("Dark", true)}${pill("Light", false)}</div></section>
  <section class="sec"><h2>Fonts</h2><p class="hint">Headings and text as a matched pair. All are free fonts served from your own event.</p><div class="pairs">${pairs}</div></section>
  <section class="sec"><h2>Corners</h2><div class="row">${pill("Square", false)}${pill("Soft", true)}${pill("Round", false)}</div></section>
  <section class="sec"><h2>Screen background</h2><p class="hint">Alive, never busy: it changes slowly between the looks you leave on, at random, with a long fade every few minutes.</p>
    <span class="lbl">Looks in the cycle</span><div class="row">${look("Glows", "glows", true)}${look("Gradient", "gradient", true)}${look("Particles", "particles", true)}</div>
    <div style="margin-top:1.1rem">${toggle("Show the game's art when a game is on", "Its art replaces the cycle while a game is building or live, then the cycle comes back.")}${toggle("Follow the time of day", "Warmer light in the morning, darker late at night.")}${toggle("More life when something big is near", "Particles and glow grow with the hype, and settle after.")}</div>
    <p class="cap--note">${icon("info")}<span>How much the screens move is set for each screen zone in Screen settings, not here. A screen starts calm and rises toward that level as the event gets busy (quiet, building, live), and quiet hours keep it calm. Try it with the chips in the preview.</span></p></section>
  <div class="foot"><a class="canccu-button canccu-button--ghost" href="#">${icon("refresh")}Reset to Default · Night</a><span class="grow"></span><a class="canccu-button canccu-button--secondary" href="#">Save as my look</a></div>
  </div>${previewColumn(k, { width: pvWidth(w), phone: w < 700, fonts: { heading: "Space Grotesk", body: "Inter" }, radius: 8, scene: "live", backdrop: "particles", logo: { plate: "light" } })}</div>`;
  return shell({ tab: "Make it yours", body, k });
}

const PLACES = ["Screen", "Phone", "Hub page", "Organiser header", "Discord"];

function cell(preset, k, plate, place) {
  const fonts = preset.fonts;
  const o = { fonts, radius: preset.radius, logo: { plate } };
  if (place === "Screen") return screen(k, { ...o, width: 260 });
  if (place === "Phone") return phone(k, { ...o, width: 80 });
  if (place === "Hub page") return hubPage(k, { ...o, width: 200 });
  if (place === "Organiser header")
    return `<div class="mini" style="width:200px;height:48px;white-space:nowrap;background:${k.surface};display:flex;align-items:center;gap:10px;padding:0 12px;box-sizing:border-box;color:${k.text}">${logo(k, { plate, h: 22, pad: 0.2 })}<b style="font-size:14px">Demo Event</b></div>`;
  return `<div class="mini" style="width:210px;padding:10px 12px 12px;background:#2b2d31;color:#dbdee1;border-left:4px solid ${k.primary};box-sizing:border-box;font-size:12px;display:flex;gap:10px;align-items:flex-start"><div style="flex:1;min-width:0"><b style="color:#fff">Doors open</b><br>Main hall at 19:50</div><span style="flex:none">${logo(k, { plate: plate === "none" ? "none" : plate, h: 26, pad: 0.15 })}</span></div>`;
}

/** Sheet 3: the black logo without a plate, then on the plate the check suggests, in every preset. */
export function platesEverywhere() {
  const rows = PRESETS.map((p) => {
    const k = p.schemes[0].colors;
    const line = (plate, label, verdict) => `<tr><th scope="row"><b>${p.name}</b><br><span class="canccu-badge ${verdict ? "canccu-badge--ok" : "canccu-badge--down"}">${label}</span></th>${PLACES.map((pl) => `<td>${cell(p, k, plate, pl)}</td>`).join("")}</tr>`;
    return line("none", "No plate: hard to see", false) + line("light", "Light plate: clear", true);
  }).join("");
  return `<main class="canccu-main canccu-main--wide" style="padding:2rem">
  <div class="canccu-pagehead"><div><h1 class="canccu-pagehead__title">A black logo on a transparent background, in every preset</h1>
  <p class="canccu-pagehead__desc">Each preset's first scheme. Top row: as uploaded. Bottom row: on the light plate the contrast check suggests. Discord's own dark grey is fixed, so the plate helps there too.</p></div></div>
  <table class="canccu-table plates"><thead><tr><th></th>${PLACES.map((p) => `<th scope="col">${p}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
  <style>.plates td,.plates th{vertical-align:middle;padding:.75rem .6rem}.plates th[scope=row]{min-width:9rem}</style></main>`;
}

export { esc, vars };
