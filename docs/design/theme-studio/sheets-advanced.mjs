// Sheets 4–5 of the pack (#784): Advanced, where every token is a control with its tooltip, and
// the actions and states every depth shares (save as my look, import, export, reset, conflicts).
import { PRESETS, contrast } from "./data.mjs";
import { icon, logo, previewColumn, screen, shell } from "./parts.mjs";
import { pvWidth } from "./sheets-look.mjs";

const LEVEL_UP = PRESETS[2];
const K = LEVEL_UP.schemes[0].colors;

/** One colour token: swatch, plain label, what it colours, and its contrast where text sits on it. */
const COLOURS = [
  ["background", "Background", "Behind everything", "text"],
  ["surface", "Boxes", "Cards and boxes", "text"],
  ["border", "Lines", "Edges of boxes and fields"],
  ["text", "Text", "Titles and body text"],
  ["text_muted", "Quiet text", "Times, places, second lines"],
  ["primary", "Main colour", "Buttons, the countdown", "primary_text"],
  ["primary_text", "Text on the main colour", "Words on buttons"],
  ["accent", "Second colour", "Labels and glows"],
  ["status_ok", "All good", "Open, on time"],
  ["status_degraded", "Needs a look", "Late, almost full"],
  ["status_down", "Problem", "Closed, cancelled"],
];

function colourRow([token, label, hint, on], tip) {
  const ratio = on ? contrast(K[on], K[token]) : null;
  const badge = ratio ? `<span class="canccu-badge canccu-badge--ok" title="Text on it">${icon("check")}Reads well</span>` : "";
  const tooltip = tip ? `<div class="tip" role="tooltip"><b>${label}</b><br>${tip}</div>` : "";
  return `<div class="tok"><button class="swatch swatch--big" type="button" style="background:${K[token]}" aria-label="${label}"></button><div><b>${label}</b> <button class="info" type="button" aria-label="About ${label}">${icon("info")}</button><br><small>${hint}</small></div>${badge}${tooltip}</div>`;
}

const slider = (label, min, max, value, unit, hint, tip) => `<div class="tok tok--slider"><div><b>${label}</b> <button class="info" type="button" aria-label="About ${label}">${icon("info")}</button><br><small>${hint}</small></div>
  <div class="range"><input type="range" min="${min}" max="${max}" value="${value}" aria-label="${label}"><output>${value} ${unit}</output></div>${tip ? `<div class="tip" role="tooltip"><b>${label}</b><br>${tip}</div>` : ""}</div>`;
const pills = (label, items, on) => `<div class="tok tok--pills"><b>${label}</b><div class="row">${items.map((t) => `<button class="pill" type="button" aria-pressed="${t === on}">${t}</button>`).join("")}</div></div>`;
const font = (label, family, hint) => `<div class="tok"><div><b>${label}</b><br><small>${hint}</small></div><button class="fontpick" type="button"><span style="font-family:'${family}'">${family}</span>${icon("right")}</button></div>`;

const CSS_LINES = [
  [".canccu-widget--countdown .canccu-widget__title {", null],
  ["  letter-spacing: 0.12em;", null],
  ["  background: url(https://example.org/flare.png);", "error"],
  ["}", null],
  ["", null],
  [".t-flare {", null],
  ["  color: var(--canccu-color-accent);", null],
  ["  font-size: 18px;", "warning"],
  ["}", null],
];

function editor() {
  const lines = CSS_LINES.map(([t, kind], i) => `<div class="ed__line${kind ? ` ed__line--${kind}` : ""}"><span class="ed__no">${i + 1}</span><code>${t.replace(/&/g, "&amp;").replace(/</g, "&lt;") || " "}</code></div>`).join("");
  return `<div class="ed">${lines}</div>
  <ul class="problems"><li class="problems--error">${icon("alert")}<span><b>Line 3:</b> Pictures from the internet are blocked on event pages. Add the picture to your theme first, then use it here.</span></li>
  <li class="problems--warn">${icon("warn")}<span><b>Line 8:</b> 18 px text is too small to read across a hall. Screens need at least 27 px.</span></li></ul>
  <div class="foot"><span class="pv__state">${icon("clock")}Checked as you type</span><span class="grow"></span><a class="canccu-button canccu-button--primary" href="#" aria-disabled="true">Save CSS</a></div>`;
}

/** Sheet 4: Advanced on Level up · Sunset, with two tooltips open and an error in the CSS. */
export function advanced(w) {
  const groups = ["Colours", "Type", "Shapes and spacing", "Screen", "Motion", "Box looks", "Your CSS"];
  const looks = [["Countdown", "Big digits", "Your look"], ["Now on", "Platform look", ""], ["Ticker", "Platform look", ""], ["Food", "Pizza slice", "Your look"]]
    .map(([box, look, mine]) => `<tr><td><b>${box}</b></td><td>${look}${mine ? ` <span class="canccu-badge">${mine}</span>` : ""}</td><td><a class="canccu-button canccu-button--ghost" href="#">Change</a></td></tr>`).join("");
  const body = `<div class="studio"><div>
  <div class="canccu-notice canccu-notice--info" role="status">${icon("info")}<div class="canccu-notice__body"><p class="canccu-notice__title">Everything, one control each</p><p>Tap the ${icon("info")} beside a setting to read what it changes. Reset to the preset brings the look's own values back.</p></div></div>
  <nav class="row groups" aria-label="Groups">${groups.map((g, i) => `<a class="pill" href="#" aria-pressed="${i === 0}">${g}</a>`).join("")}</nav>
  <section class="sec"><h2>Colours</h2><p class="hint">For the screens, the hub and the organiser pages.</p><div class="toks">${COLOURS.map((c) => colourRow(c, c[0] === "text_muted" ? `Times, places and other second lines. It reads at ${contrast(K.text_muted, K.background).toFixed(1)}:1 on the background; text needs at least 4.5:1.` : null)).join("")}</div></section>
  <section class="sec"><h2>Type</h2><div class="toks">${font("Headings", "Chakra Petch", "Titles on every page")}${font("Text", "Exo 2", "Everything else")}${font("Big screen numbers", "Chakra Petch", "Countdowns and scores")}
  <div class="tok"><div><b>Your own font</b><br><small>A WOFF2 file and its licence</small></div><a class="canccu-button canccu-button--secondary" href="#">${icon("plus")}Add a font</a></div></div></section>
  <section class="sec"><h2>Shapes and spacing</h2><div class="toks">${slider("Corner roundness", 0, 24, 14, "px", "Boxes, buttons and pictures")}${slider("Line width", 0, 4, 2, "px", "Edges of boxes")}${slider("Space between boxes", 8, 32, 16, "px", "On every page")}</div></section>
  <section class="sec"><h2>Screen</h2><div class="toks">${slider("Edge margin on screens", 24, 96, 48, "px", "Keeps text off the TV's edge", "Some TVs cut off the outer edge of the picture. Raise this if text touches the edge on yours.")}
  ${pills("Background", ["Glows", "Gradient", "Your picture", "Your video", "Game art"], "Your picture")}
  <div class="tok"><span class="bgpic" style="background:repeating-linear-gradient(115deg, ${K.accent}88 0 14px, ${K.primary}66 14px 30px, ${K.surface} 30px 50px)"></span><div><b>Arena lights</b><br><small>Picture · dimmed so text stays readable</small></div><a class="canccu-button canccu-button--ghost" href="#">Replace</a></div>
  <p class="cap">A video plays muted and looping (one per theme, up to 20 MB). On calm screens and for people who ask for less motion, its still picture shows.</p></div></section>
  <section class="sec"><h2>Motion</h2><div class="toks">${pills("Most movement", ["Still", "Calm", "Lively"], "Lively")}${pills("Speed", ["Slower", "Normal", "Faster"], "Normal")}${pills("Strength", ["Subtle", "Normal", "Strong"], "Strong")}${pills("Countdown spotlight", ["Glow and trace", "Glow", "Trace"], "Glow and trace")}${pills("Style", ["Standard", "Broadcast", "Arcade"], "Arcade")}</div></section>
  <section class="sec"><h2>Box looks</h2><p class="hint">Each box on the screen can use the platform's look or one of yours.</p><table class="canccu-table">${looks}</table>
  <div class="foot" style="margin-top:.75rem"><a class="canccu-button canccu-button--secondary" href="#">${icon("plus")}New look for a box</a></div></section>
  <section class="sec"><h2>Your CSS</h2><p class="hint">For the last details. Checked as you type; nothing unsafe can reach your pages.</p>${editor()}</section>
  </div>${previewColumn(K, { width: pvWidth(w), phone: w < 700, fonts: LEVEL_UP.fonts, radius: LEVEL_UP.radius, backdrop: "image", logo: { plate: "light" } })}</div>`;
  return shell({ tab: "Advanced", body, k: PRESETS[0].schemes[0].colors });
}

const dialog = (title, text, actions, extra = "") => `<div class="dlg"><h3>${title}</h3>${text ? `<p>${text}</p>` : ""}${extra}<div class="foot"><span class="grow"></span>${actions}</div></div>`;
const btn = (label, kind = "secondary") => `<a class="canccu-button canccu-button--${kind}" href="#">${label}</a>`;

/** Sheet 5: the actions every depth shares, and the states of saving, conflicts and the preview. */
export function actionsAndStates() {
  const k = PRESETS[0].schemes[0].colors;
  const tiles = [
    ["Save as my look", dialog("Save as my look", "Saved looks show under Your looks, here and in the next event of your series.", btn("Cancel", "ghost") + btn("Save look", "primary"), `<label class="canccu-field"><span class="canccu-field__label">Name</span><input class="canccu-input" value="Spring look"></label>`)],
    ["Import", dialog("Import a theme", null, btn("Cancel", "ghost"), `<div class="drop">${icon("download")}<b>Drop a theme file here</b><span>or <a href="#">choose one</a>. It replaces this draft; your published look stays until you publish.</span></div>`)],
    ["After an import", dialog("Imported “Level up · Sunset”", "Two things to look at before you publish:", btn("Show me", "primary"), `<ul class="problems"><li class="problems--warn">${icon("warn")}<span>The font “Bungee” is not on this platform yet, so the system font shows.</span></li><li class="problems--warn">${icon("warn")}<span>The Food box uses a look made for another box.</span></li></ul>`)],
    ["Export", dialog("Export", "A file with everything in this look: colours, fonts, pictures, box looks and CSS. Import it into another event or keep it as a copy.", btn("Download the published look") + btn("Download this draft", "primary"))],
    ["Reset to the preset", dialog("Reset to Level up · Sunset?", "Colours, fonts, corners, the background and motion go back to the look's own. Your logo and its plate stay.", btn("Cancel", "ghost") + btn("Reset", "primary"))],
    ["Using a look over your own changes", dialog("Use Terminal · Amber?", "This replaces your own CSS, fonts and box looks. Your logo and its plate stay. Export first to keep a copy.", btn("Export first", "ghost") + btn("Cancel") + btn("Use this look", "primary"))],
  ].map(([cap, d]) => `<figure class="state">${d}<figcaption>${cap}</figcaption></figure>`).join("");
  const savestates = [["clock", "Saving…"], ["check", "Saved"], ["warn", "Not saved: you are offline. Trying again…"]]
    .map(([i, t]) => `<span class="savestate">${icon(i)}${t}</span>`).join("");
  const loading = `<div class="frame" style="width:360px;height:203px;display:grid;place-items:center;background:${k.surface};color:${k.text_muted}"><span>${icon("clock")} Drawing your preview…</span></div>`;
  return `<main class="canccu-main canccu-main--wide" style="padding:2rem">
  <div class="canccu-pagehead"><div><h1 class="canccu-pagehead__title">Actions and states</h1><p class="canccu-pagehead__desc">The same on every depth: Pick a look, Make it yours and Advanced.</p></div></div>
  <div class="states">${tiles}</div>
  <h2 class="h2">Saving, in the page head</h2><div class="row">${savestates}</div>
  <h2 class="h2">Someone else changed the theme</h2><div class="canccu-notice canccu-notice--warn" role="alert" style="max-width:44rem">${icon("warn")}<div class="canccu-notice__body"><p class="canccu-notice__title">Another organiser changed this theme a moment ago</p><p>Your last change was not saved, so nothing of theirs is lost. Reload to see their change, then make yours again.</p><div class="canccu-notice__actions">${btn("Reload", "primary")}</div></div></div>
  <h2 class="h2">The preview</h2><div class="row" style="align-items:flex-start;gap:1.5rem"><figure class="state">${loading}<figcaption>Loading</figcaption></figure>
  <figure class="state">${screen(k, { width: 360, logo: { plate: "light" } })}<figcaption>Ready: Publish is on</figcaption></figure>
  <figure class="state"><div class="row"><span class="canccu-button canccu-button--primary" aria-disabled="true" style="opacity:.55">${icon("clock")}Waiting for the preview</span></div><p class="cap" style="max-width:16rem">While a preview still shows an older change, Publish waits. It turns on by itself once every preview shows your latest change.</p><figcaption>Publish held</figcaption></figure></div>
  </main>`;
}

export { logo };
