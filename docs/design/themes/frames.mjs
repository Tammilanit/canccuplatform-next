// The documents the pack renders (#785, plan Part 0): a screen at 1920×1080 in one of three views
// (hero, rail, announcement) and a hub page, each in one preset and scheme. A document is the
// screen's or the hub's stable-class markup with the preset's tokens, its font pair (local files
// from modules/theming/fonts) and, for an advanced preset, its look's CSS (looks/<id>.css), so
// the PO sees what Parts 1 and 2 ship. All content is the demo event's: no real names.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, pair } from "./data.mjs";
import { FREEZE, HUB_BASE, SCREEN_BASE } from "./style.mjs";

const HERE = join(ROOT, "docs/design/themes");
const url = (...p) => pathToFileURL(join(ROOT, ...p)).href;
const RADIUS = { square: "0", soft: "0.5rem", round: "1rem" };

const TEAMS = [["Night Owls", 2480], ["Pixel Pirates", 2315], ["Team Lagless", 2190], ["Ctrl Alt Defeat", 1975], ["Respawn Crew", 1840]];
const AGENDA = [["17:00", "Open play", "Hall B", true], ["18:00", "Quarter-finals", "Hall A"], ["19:30", "Pizza order closes", "Kiosk"], ["21:00", "Quiz night", "Stage"]];
const ORDINAL = ["1ST", "2ND", "3RD", "4TH", "5TH"];

/** The `@font-face` rules of a platform font pair, from its own files. */
export function pairFaces(id) {
  const p = pair(id);
  return [p.heading, p.body]
    .flatMap((fam) => fam.faces.map((f) => `@font-face{font-family:"${fam.family}";font-weight:${f.weight};font-display:block;src:url(${url("modules/theming/fonts", id, f.file)}) format("woff2")}`))
    .join("\n");
}

/** The tokens a preset's scheme sets, as the theme's token CSS does (contracts/theming.md). */
export function tokens(preset, colors) {
  const p = pair(preset.pair);
  const v = Object.entries(colors).map(([k, x]) => `--canccu-color-${k.replace("_", "-")}:${x}`);
  v.push(`--canccu-font-heading:"${p.heading.family}",system-ui,sans-serif`, `--canccu-font-display:"${p.heading.family}",system-ui,sans-serif`);
  v.push(`--canccu-font-body:"${p.body.family}",system-ui,sans-serif`, `--canccu-radius:${RADIUS[preset.roundness]}`);
  v.push("--canccu-border-width:2px", "--canccu-gap:1rem", "--canccu-safe-inset:48px");
  return `:root{${v.join(";")}}`;
}

const head = (preset, colors, base) => [
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${preset.name}</title>`,
  `<link rel="stylesheet" href="${url("packages/ui/ui.css")}">`,
  `<style>${pairFaces(preset.pair)}\n${base}\n${tokens(preset, colors)}</style>`,
  preset.css ? `<link rel="stylesheet" href="${pathToFileURL(join(HERE, "looks", preset.css)).href}">` : "",
  `<style>${FREEZE}</style></head>`,
].join("");

const widget = (type, title, body) => `<div class="canccu-widget canccu-widget--${type}">${title ? `<h2 class="canccu-widget__title">${title}</h2>` : ""}<div class="canccu-widget__body">${body}</div></div>`;
const region = (id, [col, row, cols, rows], inner) => `<section class="canccu-region canccu-region--${id}" style="grid-area:${row} / ${col} / span ${rows} / span ${cols}">${inner}</section>`;

/** The leaderboard: the preset's template when it has one (plan D6), else the platform's list. */
function leaderboard(preset, n = 5) {
  const rows = TEAMS.slice(0, n);
  if (preset.id === "esports")
    return `<ol class="t-esports-score">${rows.map(([t, p], i) => `<li class="t-esports-score__row"><span class="t-esports-score__rank">${i + 1}</span><span>${t}</span><span class="t-esports-score__points">${p}</span></li>`).join("")}</ol>`;
  if (preset.id === "arcade")
    return `<ol class="t-arcade-hiscore">${rows.map(([t, p], i) => `<li class="t-arcade-hiscore__row"><span class="t-arcade-hiscore__rank">${ORDINAL[i]}</span><span>${t.toUpperCase()}</span><span class="t-arcade-hiscore__dots"></span><span class="t-arcade-hiscore__score">${p}</span></li>`).join("")}</ol>`;
  return `<ol class="t-pack-rows">${rows.map(([t, p], i) => `<li><span class="t-pack-when">#${i + 1}</span><span>${t}</span><span>${p}</span></li>`).join("")}</ol>`;
}

const clock = (preset) =>
  preset.id === "arcade"
    ? `<div class="t-arcade-clock">18:42<span class="t-arcade-clock__day">SATURDAY</span></div>`
    : `<div class="t-pack-clock">18:42<small>Saturday</small></div>`;

const TICKER = "Pizza order closes at 19:30 · Bring your own cable to the swap table · Check-in desk open until 22:00";
const ticker = (preset) =>
  preset.id === "esports"
    ? `<div class="t-esports-lower"><span class="t-esports-lower__tab">Live</span><span class="t-esports-lower__line">${TICKER}</span></div>`
    : TICKER;

const agenda = (n = 4) => `<ol class="t-pack-rows">${AGENDA.slice(0, n).map(([w, what, where, now]) => `<li><span class="t-pack-when">${w}</span><span class="${now ? "t-pack-now" : ""}">${now ? "Now: " : ""}${what}</span><span class="t-pack-where">${where}</span></li>`).join("")}</ol>`;
const countdown = `<span class="t-pack-kicker">Quarter-finals start in</span><span class="t-pack-big">12:40</span>`;
const logo = `<img src="${url("events/demo/themes/default/images/logo.svg")}" alt="Demo LAN">`;

function header(preset, withFood = true) {
  return [
    region("brand", [1, 1, 4, 2], widget("logo", "", logo)),
    withFood ? region("food", [5, 1, 13, 2], widget("food_status", "Food", `<p class="t-pack-food"><strong>Pizza order open</strong> · closes 19:30</p>`)) : "",
    region("clock", [18, 1, 7, 2], widget("clock", "", clock(preset))),
  ].join("");
}

/** A screen's regions in one view: the everyday rail, a hero with its rail, or an announcement. */
function view(preset, name) {
  const tick = region("ticker", [1, 12, 24, 1], widget("ticker", "", ticker(preset)));
  if (name === "rail")
    return header(preset) +
      region("now", [1, 3, 9, 9], widget("agenda_now", "Now and next", agenda())) +
      region("ladder", [10, 3, 8, 9], widget("leaderboard", "Leaderboard", leaderboard(preset))) +
      region("countdown", [18, 3, 7, 4], widget("countdown", "Countdown", countdown)) +
      region("spotlight", [18, 7, 7, 5], widget("announcements", "Welcome", `<p>Wi-Fi: DemoLAN<br>Help desk by the stage</p>`)) + tick;
  if (name === "hero")
    return header(preset) +
      region("_full", [1, 3, 17, 9], widget("countdown", "Countdown", countdown)) +
      region("rail", [18, 3, 7, 9], widget("agenda_now", "Next", agenda(2)) + widget("leaderboard", "Top three", leaderboard(preset, 3))) + tick;
  return header(preset, false) +
    region("_full", [1, 3, 24, 9], widget("announcement", "Quarter-finals in 10 minutes", `<p>Teams to Hall A. Bring your headset.</p>`)) + tick;
}

/** A screen document: one view, one scheme, one motion level. */
export function screenDoc(preset, scheme, name, level = "calm") {
  const body = `canccu-page canccu-surface canccu-surface--screen canccu-motion--${level} canccu-motion-pack--${preset.pack}`;
  return `${head(preset, scheme.colors, SCREEN_BASE)}<body class="${body}"><div class="canccu-stage"><div class="canccu-stage__glow" data-look="${preset.looks[0]}"></div></div><main class="canccu-layout canccu-layout--main">${view(preset, name)}</main></body></html>`;
}

/** A hub page: the same event on a phone or a PC, with the preset's colours, fonts and corners. */
export function hubDoc(preset, scheme) {
  const card = (title, body, cls = "") => `<section class="canccu-card ${cls}"><h2 class="canccu-card__title">${title}</h2>${body}</section>`;
  return `${head(preset, scheme.colors, HUB_BASE)}<body class="canccu-page canccu-surface canccu-surface--hub">` +
    `<header class="canccu-header"><img class="canccu-header__logo" src="${url("events/demo/themes/default/images/logo.svg")}" alt=""><span class="canccu-header__title">Demo LAN</span></header>` +
    `<main class="canccu-main t-pack-hub">` +
    card("Coming up", countdown, "t-pack-hero") +
    card("Now and next", agenda()) +
    card("Leaderboard", `<ol class="t-pack-rows">${TEAMS.map(([t, p], i) => `<li><span class="t-pack-when">#${i + 1}</span><span>${t}</span><span>${p}</span></li>`).join("")}</ol>`) +
    card("Food", `<p class="t-pack-food"><strong>Pizza order open</strong> until 19:30</p><a class="canccu-button canccu-button--primary" href="#">Order pizza</a>`) +
    card("Announcements", `<p>Quarter-finals in 10 minutes. Teams to Hall A.</p>`) +
    `</main></body></html>`;
}
