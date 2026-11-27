// The documents the pack renders (#785, plan Part 0): a screen at 1920×1080 in one of three views
// on the living screen's layout (#787: a rotation hero, a full rail, the ticker; #780's full-screen
// announcement) and a hub page, each in one preset and scheme. A document is the screen's or the
// hub's stable-class markup with the preset's tokens, its font pair (local files) and, for an
// advanced preset, its look's CSS (looks/<id>.css), so the PO sees what Parts 1 and 2 ship. All
// content is the demo event's: no real names.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, minBoxOpacity, pair } from "./data.mjs";
import { logo } from "./logos.mjs";
import { HUB_BASE, LIVING, SCREEN_BASE, freeze } from "./style.mjs";

const HERE = join(ROOT, "docs/design/themes");
const url = (...p) => pathToFileURL(join(ROOT, ...p)).href;
const RADIUS = { square: "0", soft: "0.5rem", round: "1rem", pill: "2.5rem" };

const TEAMS = [["Night Owls", 2480], ["Pixel Pirates", 2315], ["Team Lagless", 2190], ["Ctrl Alt Defeat", 1975], ["Respawn Crew", 1840]];
const AGENDA = [["19:00", "Quarter-finals", "Hall A"], ["19:30", "Pizza order closes", "Kiosk"], ["21:00", "Quiz night", "Stage"], ["22:15", "Finals", "Hall A"]];
const ORDINAL = ["1ST", "2ND", "3RD", "4TH", "5TH"];
const TICKER = "Pizza order closes at 19:30 · Bring your own cable to the swap table · Check-in desk open until 22:00";

/** The `@font-face` rules of a font pair, from its own files (the platform's, or the pack's). */
export function pairFaces(id) {
  const p = pair(id);
  return [p.heading, p.body]
    .flatMap((fam) => fam.faces.map((f) => `@font-face{font-family:"${fam.family}";font-weight:${f.weight};font-display:block;src:url(${pathToFileURL(join(p.dir, f.file)).href}) format("${f.file.endsWith(".ttf") ? "truetype" : "woff2"}")}`))
    .join("\n");
}

/** The box opacity a scheme draws: the preset's own, raised where the scheme's contrast needs it. */
export const boxOpacity = (preset, scheme) => Math.max(preset.boxOpacity, minBoxOpacity(scheme.colors));

/** The tokens a preset's scheme sets, as the theme's token CSS does (contracts/theming.md). */
export function tokens(preset, scheme) {
  const p = pair(preset.pair);
  const v = Object.entries(scheme.colors).map(([k, x]) => `--canccu-color-${k.replace("_", "-")}:${x}`);
  v.push(`--canccu-font-heading:"${p.heading.family}",system-ui,sans-serif`, `--canccu-font-display:"${p.heading.family}",system-ui,sans-serif`);
  v.push(`--canccu-font-body:"${p.body.family}",system-ui,sans-serif`, `--canccu-radius:${RADIUS[preset.roundness]}`);
  v.push("--canccu-border-width:2px", "--canccu-gap:1rem", "--canccu-safe-inset:48px", `--canccu-box-opacity:${boxOpacity(preset, scheme)}`);
  return `:root{${v.join(";")}}`;
}

const head = (preset, scheme, base, t) => [
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${preset.name}</title>`,
  `<link rel="stylesheet" href="${url("packages/ui/ui.css")}">`,
  `<style>${pairFaces(preset.pair)}\n${base}\n${LIVING}\n${tokens(preset, scheme)}</style>`,
  preset.css ? `<link rel="stylesheet" href="${pathToFileURL(join(HERE, "looks", preset.css)).href}">` : "",
  preset.css && existsSync(join(HERE, "looks", `stand-in-${preset.css}`)) ? `<link rel="stylesheet" href="${pathToFileURL(join(HERE, "looks", `stand-in-${preset.css}`)).href}">` : "",
  `<style>${freeze(t)}</style></head>`,
].join("");

const widget = (type, title, body, cls = "") => `<div class="canccu-widget canccu-widget--${type} ${cls}">${title ? `<h2 class="canccu-widget__title">${title}</h2>` : ""}<div class="canccu-widget__body">${body}</div></div>`;
const region = (id, [col, row, cols, rows], inner) => `<section class="canccu-region canccu-region--${id}" style="grid-area:${row} / ${col} / span ${rows} / span ${cols}">${inner}</section>`;

/** The leaderboard: the preset's template when it has one (plan D6), else the platform's list. */
export function leaderboard(preset, n = 5) {
  const rows = TEAMS.slice(0, n);
  if (preset.id === "esports")
    return `<ol class="t-esports-score">${rows.map(([t, p], i) => `<li class="t-esports-score__row"><span class="t-esports-score__rank">${i + 1}</span><span>${t}</span><span class="t-esports-score__points">${p}</span></li>`).join("")}</ol>`;
  if (preset.id === "arcade")
    return `<ol class="t-arcade-hiscore">${rows.map(([t, p], i) => `<li class="t-arcade-hiscore__row"><span class="t-arcade-hiscore__rank">${ORDINAL[i]}</span><span>${t.toUpperCase()}</span><span class="t-arcade-hiscore__dots"></span><span class="t-arcade-hiscore__score">${p}</span></li>`).join("")}</ol>`;
  return `<ol class="t-pack-rows">${rows.map(([t, p], i) => `<li><span class="t-pack-when">#${i + 1}</span><span>${t}</span><span>${p}</span></li>`).join("")}</ol>`;
}

export const clock = (preset) =>
  preset.id === "arcade"
    ? `<div class="t-arcade-clock">18:42<span class="t-arcade-clock__day">SATURDAY</span></div>`
    : `<div class="t-pack-clock">18:42<small>Saturday</small></div>`;

const ticker = (preset) =>
  preset.id === "esports"
    ? `<div class="t-esports-lower"><span class="t-esports-lower__tab">Live</span><span class="t-esports-lower__line">${TICKER}</span></div>`
    : TICKER;

const runOfShow = (n) => `<ol class="t-pack-rows">${AGENDA.slice(0, n).map(([w, what, where]) => `<li><span class="t-pack-when">${w}</span><span class="t-pack-what">${what}<small>${where}</small></span></li>`).join("")}</ol>`;
const food = `<p class="t-pack-food"><strong>Pizza order open</strong><span>closes 19:30 · 9 pizzas so far</span></p>`;
const wifi = `<p class="t-pack-food"><strong>DemoLAN</strong><span>Password: pizza-time</span></p>`;

/** A scan code that is not one: finder squares and a fixed pattern, so no real link is drawn. */
function qr() {
  const cells = [];
  for (let y = 0; y < 21; y++)
    for (let x = 0; x < 21; x++) {
      const finder = (x < 7 || x > 13) && (y < 7 || y > 13) && !(x > 13 && y > 13);
      const on = finder ? (() => { const fx = x % 14, fy = y % 14; return fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx > 1 && fx < 5 && fy > 1 && fy < 5); })() : ((x * 7 + y * 13 + x * y) % 5 < 2);
      if (on) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
    }
  return `<svg viewBox="0 0 21 21" fill="#111" aria-hidden="true">${cells.join("")}</svg>`;
}

/** The coming hours (#787): the evening on two lanes with a now line; one hour is 183 px. */
function timeline(band) {
  const PX = 183;
  const at = (h) => Math.round((h - 17) * PX);
  const block = (name, from, to, lane, cls = "") => `<div class="t-pack-block ${cls}" style="left:${at(from)}px;width:${at(to) - at(from) - 8}px;top:${8 + lane * 128}px">${name}<small>${String(Math.floor(from)).padStart(2, "0")}:${from % 1 ? "30" : "00"}–${String(Math.floor(to)).padStart(2, "0")}:${to % 1 ? "30" : "00"}</small></div>`;
  const ticks = [17, 18, 19, 20, 21, 22, 23].map((h) => `<span style="left:${at(h)}px">${h}:00</span>`).join("");
  return `<div class="t-pack-axis">${block("Open play", 17, 19, 0)}${block("Quarter-finals", 19, 20.5, 1, "t-pack-block--b")}${block("Quiz night", 21, 22.5, 0)}${band ? "" : block("Check-in desk open", 17, 22, 2)}` +
    `<div class="t-pack-now-line" style="left:${at(18.7)}px"></div>${band ? "" : `<div class="t-pack-mark-line" style="left:${at(19.5)}px">Pizza order closes 19:30</div>`}<div class="t-pack-ticks">${ticks}</div></div>`;
}

const nowNext = `<div class="t-pack-line"><span class="t-pack-pill">Now</span><span>Open play · until 19:00</span></div><span class="t-pack-kicker">Next</span><span class="t-pack-name">Quarter-finals</span><span class="t-pack-place">19:00 · Hall A</span><span class="t-pack-kicker">Starts in</span><span class="t-pack-big">17:58</span><div class="canccu-widget__timebar"><i style="width:32%"></i></div>`;

function header(preset) {
  return region("brand", [1, 1, 16, 2], widget("logo", "", logo(preset))) + region("clock", [17, 1, 8, 2], widget("clock", "", clock(preset)));
}

/** A screen's regions in one view. A preset with a horizon band (Synthwave) leaves its rows 9–11 free. */
function view(preset, name) {
  const R = preset.band ? 6 : 9;
  const tick = region("ticker", [1, 12, 24, 1], widget("ticker", "", ticker(preset)));
  if (name === "hero")
    return header(preset) +
      region("hero", [1, 3, 16, R], widget("countdown", "Now and next", nowNext, "t-pack-hero-box")) +
      region("rail", [17, 3, 8, R], widget("agenda_now", "Run of show", runOfShow(preset.band ? 2 : 3)) + widget("food_status", "Food", food) + (preset.band ? "" : widget("announcements", "Wi-Fi", wifi))) + tick;
  if (name === "rail")
    return header(preset) +
      region("hero", [1, 3, 16, R], widget("agenda_timeline", "The coming hours", `<span class="t-pack-place">Tonight, from now to midnight</span>${timeline(preset.band)}`, "t-pack-hero-box")) +
      region("rail", [17, 3, 8, R], widget("leaderboard", "Standings", leaderboard(preset, 3)) + (preset.band ? "" : widget("agenda_now", "Next up", runOfShow(1))) + widget("food_status", "Food", food)) + tick;
  const rows = preset.band ? 8 : 11;
  const ann = `<div class="canccu-widget canccu-widget--announcement canccu-is-claim"><span class="canccu-widget__kicker">Important</span><h2 class="canccu-widget__title">Pizza is here</h2><div class="canccu-widget__body"><p>Order 12 · collect at the entrance table</p></div><span class="canccu-widget__second">Posted 1 min ago</span><div class="canccu-widget__timebar"><i style="width:64%"></i></div><span class="t-pack-left">2 min left</span></div>`;
  return region("hero", [1, 1, 17, rows], ann) +
    region("details", [18, 1, 7, rows], widget("details", "", `<div class="t-pack-clock">21:33</div>${`<div class="t-pack-food"><strong>Order 12 · here</strong><span>Order 14 · open, closes 22:00</span></div>`}<div class="t-pack-qr">${qr()}<span>Details on your phone<br><span class="t-pack-place">Scan for your order</span></span></div>`)) + tick;
}

/** A screen document: one view, one scheme, one motion level, frozen t seconds into its motion. */
export function screenDoc(preset, scheme, name, level = "calm", t = 1.2) {
  const body = `canccu-page canccu-surface canccu-surface--screen canccu-motion--${level} canccu-motion-pack--${preset.pack}${preset.band ? " t-pack-band" : ""}`;
  return `${head(preset, scheme, SCREEN_BASE, t)}<body class="${body}"><div class="canccu-stage"><div class="canccu-stage__glow" data-look="${preset.looks[0]}"></div></div><main class="canccu-layout canccu-layout--main">${view(preset, name)}</main></body></html>`;
}

/** A hub page, laid out for its width (0032): a bar, then the hero and food, then three cards. */
export function hubDoc(preset, scheme) {
  const card = (title, body, cls = "") => `<section class="canccu-card ${cls}"><h2 class="canccu-card__title">${title}</h2>${body}</section>`;
  const table = TEAMS.map(([t, p], i) => `<li><span class="t-pack-when">#${i + 1}</span><span>${t}</span><span>${p}</span></li>`).join("");
  const style = preset.id === "arcade" ? `<style>body{--t-pack-fs:1.4;--t-pack-h:0.75}</style>` : "";
  const bar = `<header class="t-pack-bar">${logo(preset)}<nav><a href="#">Today</a><a href="#">Schedule</a><a href="#">Play</a><a href="#">Food</a></nav></header>`;
  return `${head(preset, scheme, HUB_BASE, 0)}<body class="canccu-page canccu-surface canccu-surface--hub">${style}${bar}<main class="t-pack-hub">` +
    card("Coming up", `<span class="t-pack-kicker">Quarter-finals · 19:00 · Hall A · starts in</span><span class="t-pack-big">17:58</span><span class="t-pack-place">Open play ends at 19:00</span>`, "t-pack-hero") +
    card("Food", `${food}<a class="canccu-button canccu-button--primary" href="#">Order pizza</a>`) +
    card("Now and next", runOfShow(4)) +
    card("Leaderboard", `<ol class="t-pack-rows">${table}</ol>`) +
    card("Announcements", `<p class="t-pack-note">Quarter-finals in 10 minutes. Teams to Hall A.<small>1 min ago</small></p><p class="t-pack-note">Lost and found is at the info desk.<small>40 min ago</small></p>`) +
    `</main></body></html>`;
}
