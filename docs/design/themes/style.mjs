// The pack's own CSS (#785, plan D9). SCREEN_BASE stands in for the screen player's base layer
// (modules/screen/player/src: the stage, the layout grid, a widget's box and title), so a look's
// CSS (looks/<id>.css) restyles it as it restyles the real player: unlayered rules over
// `canccu-base`. HUB_BASE lays out the hub's cards; packages/ui's ui.css draws them. SHEET_CSS
// draws the overview and the effects board. Pack-only classes start with `t-pack-`.

/** The rows and big numbers the screen and the hub share. */
const SHARED = `
.t-pack-rows { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.t-pack-rows li { display: grid; grid-template-columns: 5.5rem 1fr auto; gap: 16px; align-items: baseline; }
.t-pack-rows .t-pack-when { font-family: var(--canccu-font-heading); color: var(--canccu-color-primary); font-variant-numeric: tabular-nums; }
.t-pack-rows .t-pack-where { color: var(--canccu-color-text-muted); }
.t-pack-rows .t-pack-now { color: var(--canccu-color-accent); }
.t-pack-big { display: block; font-family: var(--canccu-font-heading); font-size: 8rem; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
.t-pack-kicker { display: block; font-size: 2.25rem; color: var(--canccu-color-text-muted); }
`;

export const SCREEN_BASE = `${SHARED}@layer canccu-base {
  html, body { margin: 0; width: 100vw; height: 100vh; overflow: hidden; }
  body.canccu-surface--screen {
    background: var(--canccu-color-background); color: var(--canccu-color-text);
    font-family: var(--canccu-font-body); font-size: 1.75rem; line-height: 1.25;
  }
  .canccu-stage { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
  .canccu-stage > * { position: absolute; inset: 0; }
  .canccu-stage__glow { inset: -20%; background-image:
    radial-gradient(ellipse 64% 50% at 64% 0%, color-mix(in srgb, var(--canccu-color-primary) 22%, transparent), transparent),
    radial-gradient(ellipse 46% 40% at 8% 96%, color-mix(in srgb, var(--canccu-color-accent) 12%, transparent), transparent); }
  .canccu-stage__glow[data-look="gradient"] { background-image:
    linear-gradient(135deg, color-mix(in srgb, var(--canccu-color-primary) 26%, transparent), transparent 42%, transparent 62%, color-mix(in srgb, var(--canccu-color-accent) 22%, transparent)); }
  .canccu-stage__glow[data-look="particles"] { background-image:
    radial-gradient(circle, color-mix(in srgb, var(--canccu-color-primary) 55%, transparent) 3px, transparent 4px),
    radial-gradient(circle, color-mix(in srgb, var(--canccu-color-accent) 45%, transparent) 2px, transparent 3px),
    radial-gradient(ellipse 50% 40% at 30% 30%, color-mix(in srgb, var(--canccu-color-primary) 14%, transparent), transparent);
    background-size: 160px 160px, 110px 110px, 100% 100%; background-position: 0 0, 50px 70px, 0 0; }
  .canccu-stage__glow[data-look="waves"] { background-image:
    radial-gradient(120% 40% at 50% 100%, color-mix(in srgb, var(--canccu-color-primary) 20%, transparent), transparent 70%),
    radial-gradient(120% 30% at 40% 85%, color-mix(in srgb, var(--canccu-color-accent) 16%, transparent), transparent 70%); }
  /* Two looks the presets add to the platform's four (plan D12): the warm glow of a hearth, rising from the bottom,
     and a sky with a soft sun. Both are the stage's own layer, so a simple theme can pick them. */
  .canccu-stage__glow[data-look="hearth"] { background-image:
    radial-gradient(ellipse 80% 55% at 50% 100%, color-mix(in srgb, var(--canccu-color-primary) 42%, transparent), transparent),
    radial-gradient(ellipse 40% 40% at 16% 96%, color-mix(in srgb, var(--canccu-color-accent) 24%, transparent), transparent); }
  .canccu-stage__glow[data-look="sky"] { background-image:
    radial-gradient(circle 26vh at 84% 16%, color-mix(in srgb, var(--canccu-color-accent) 55%, transparent), transparent 72%),
    linear-gradient(180deg, color-mix(in srgb, var(--canccu-color-primary) 26%, transparent), transparent 52%, color-mix(in srgb, var(--canccu-color-accent) 22%, transparent)); }
  .canccu-layout { position: absolute; inset: var(--canccu-safe-inset); display: grid;
    grid-template-columns: repeat(24, 1fr); grid-template-rows: repeat(12, 1fr); gap: var(--canccu-gap); }
  .canccu-region { display: flex; flex-direction: column; gap: var(--canccu-gap); min-height: 0; min-width: 0; }
  .canccu-region > .canccu-widget { flex: 1; }
  .canccu-widget { position: relative; box-sizing: border-box; height: 100%; min-height: 0; padding: 22px 28px; overflow: hidden;
    background: color-mix(in srgb, var(--canccu-color-surface) calc(var(--canccu-box-opacity, 1) * 100%), transparent);
    border: var(--canccu-border-width) solid var(--canccu-color-border); border-radius: var(--canccu-radius); }
  .canccu-widget__title { margin: 0 0 14px; font-family: var(--canccu-font-heading); font-size: 1.75rem; font-weight: 700;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--canccu-color-text-muted); }
  .canccu-widget__body { margin: 0; }
  .canccu-widget--clock { display: flex; align-items: center; }
  .canccu-widget--ticker { display: flex; align-items: center; padding: 0 28px; white-space: nowrap; }
}
.t-pack-clock { margin-left: auto; font-family: var(--canccu-font-heading); font-size: 3rem; font-weight: 700; text-align: right; line-height: 1; }
.t-pack-clock small { display: block; font-size: 1.75rem; font-weight: 400; color: var(--canccu-color-text-muted); }
`;

/** The living screen's boxes (#787): the hero, the rail's tiles, the timeline and the announcement
 *  (#780). A stand-in for the player's own CSS: the same parts, sizes in em so a look's font scales them. */
export const LIVING = `
.t-pack-flow { display: flex; flex-direction: column; }
.canccu-region > .canccu-widget { flex: 1 1 auto; }
.canccu-widget--logo { padding: 10px 28px; display: flex; align-items: center; }
.t-pack-logo { display: flex; align-items: center; gap: 22px; width: 100%; }
.t-pack-mark { flex: none; width: 76px; height: 76px; }
.t-pack-word { flex: none; font-family: var(--canccu-font-heading); font-size: 3.25rem; font-weight: 700; line-height: 1; white-space: nowrap; }
.t-pack-tag { flex: 1; margin-left: 12px; padding: 8px 0 8px 28px; border-left: 3px solid var(--canccu-color-primary); color: var(--canccu-color-text-muted); font-size: 1em; white-space: nowrap; }
.t-pack-hero-box { display: flex; flex-direction: column; }
.t-pack-hero-box .canccu-widget__body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
.t-pack-pill { display: inline-block; margin-right: 18px; padding: 2px 18px; border-radius: 999px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--canccu-color-primary-text); background: var(--canccu-color-status-ok); }
.t-pack-name { display: block; font-family: var(--canccu-font-heading); font-size: 6rem; font-weight: 700; line-height: 1.05; }
.t-pack-place { display: block; color: var(--canccu-color-text-muted); }
.canccu-widget__timebar { height: 12px; margin-top: 18px; overflow: hidden; border-radius: 6px; background: color-mix(in srgb, var(--canccu-color-text) 14%, transparent); }
.canccu-widget__timebar > i { display: block; height: 100%; background: var(--canccu-color-primary); }
.t-pack-rows .t-pack-what small { display: block; color: var(--canccu-color-text-muted); font-size: 1em; }
.t-pack-tile .t-pack-big { font-size: 4rem; }
.t-pack-food strong { color: var(--canccu-color-status-ok); display: block; }
.t-pack-food span { color: var(--canccu-color-text-muted); display: block; }
.t-pack-line { display: flex; align-items: center; margin-bottom: 14px; }
.t-pack-hero-box .t-pack-big { font-size: 10rem; }
.t-pack-hero-box .t-pack-kicker { font-size: 1em; margin-top: 10px; text-transform: uppercase; letter-spacing: 0.08em; }

/* The coming hours: a timeline on two lanes, one hour per 160 px, with a "now" line. */
.t-pack-axis { position: relative; flex: 1; margin: 10px 28px 0 28px; }
.t-pack-block { position: absolute; box-sizing: border-box; height: 112px; padding: 10px 16px; overflow: hidden; border-left: 8px solid var(--canccu-color-primary);
  border-radius: calc(var(--canccu-radius) * 0.6); background: color-mix(in srgb, var(--canccu-color-primary) 22%, var(--canccu-color-surface)); line-height: 1.15; white-space: nowrap; }
.t-pack-block small { display: block; color: var(--canccu-color-text-muted); font-size: 1em; }
.t-pack-block--b { border-left-color: var(--canccu-color-accent); background: color-mix(in srgb, var(--canccu-color-accent) 20%, var(--canccu-color-surface)); }
.t-pack-now-line { position: absolute; top: 0; bottom: 56px; width: 4px; background: var(--canccu-color-text); }
.t-pack-now-line::before { content: "now"; position: absolute; top: -4px; left: 10px; padding: 0 14px; border-radius: 999px; color: var(--canccu-color-background); background: var(--canccu-color-text); }
.t-pack-ticks { position: absolute; left: 0; right: 0; bottom: 0; height: 48px; border-top: 3px solid var(--canccu-color-border); }
.t-pack-ticks span { position: absolute; top: 8px; transform: translateX(-50%); color: var(--canccu-color-text-muted); }
.t-pack-mark-line { position: absolute; bottom: 48px; padding-left: 8px; border-left: 3px solid var(--canccu-color-status-degraded); color: var(--canccu-color-status-degraded); white-space: nowrap; }

/* The full-screen announcement (#780): glow, the badge, a headline across the hall, a timebar, and
   the details beside it (clock, food, QR). The drift is a slow gradient under the text. */
.canccu-widget--announcement { display: flex; flex-direction: column; justify-content: center; gap: 10px; padding: 48px 72px; }
.canccu-widget--announcement::before { content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background: radial-gradient(ellipse 50% 60% at 30% 70%, color-mix(in srgb, var(--canccu-color-primary) 28%, transparent), transparent), radial-gradient(ellipse 40% 50% at 80% 20%, color-mix(in srgb, var(--canccu-color-accent) 20%, transparent), transparent); }
.canccu-widget--announcement > * { position: relative; z-index: 1; }
.canccu-widget__kicker { align-self: flex-start; padding: 2px 22px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--canccu-color-primary-text); background: var(--canccu-color-primary); border-radius: 999px; }
.canccu-widget--announcement .canccu-widget__title { margin: 8px 0 0; font-size: 7.5rem; line-height: 1.02; letter-spacing: 0; text-transform: none; color: var(--canccu-color-text); }
.canccu-widget--announcement .canccu-widget__body { margin: 0; font-size: 2.75rem; color: var(--canccu-color-text); }
.canccu-widget__second { color: var(--canccu-color-text-muted); font-size: 1em; }
.canccu-widget--announcement .canccu-widget__timebar { margin-top: 28px; height: 14px; }
.t-pack-left { color: var(--canccu-color-text-muted); text-align: right; }
.canccu-widget--details { display: flex; flex-direction: column; justify-content: center; gap: 14px; }
body.t-pack-band .t-pack-hero-box .t-pack-name { font-size: 4.25rem; }
body.t-pack-band .t-pack-hero-box .t-pack-big { font-size: 7rem; }
body.t-pack-band .t-pack-hero-box .t-pack-line { margin-bottom: 6px; }
body.t-pack-band .canccu-widget__timebar { margin-top: 8px; }
.canccu-widget__kicker { margin-bottom: 6px; }
.canccu-widget--details .t-pack-clock { margin: 0; font-size: 5.5rem; text-align: left; }
.canccu-widget--details .t-pack-food { padding-top: 12px; border-top: 2px solid var(--canccu-color-border); }
.t-pack-qr { display: flex; align-items: center; gap: 24px; padding-top: 12px; border-top: 2px solid var(--canccu-color-border); }
.t-pack-qr svg { flex: none; width: 150px; height: 150px; padding: 8px; background: #fff; border-radius: 6px; }
`;

/** The hub (0032: equal on PC and phone): a bar, then a layout for the width. At 1280 px the hero and
 *  food take the first row and three cards the second, filling the width; on a phone one column. */
export const HUB_BASE = `${SHARED}
body.canccu-surface--hub { margin: 0; font-size: calc(1.125rem * var(--t-pack-fs, 1)); line-height: 1.45; }
.t-pack-bar { display: flex; align-items: center; gap: 28px; padding: 14px 40px; border-bottom: 1px solid var(--canccu-color-border); background: var(--canccu-color-surface); }
.t-pack-bar .t-pack-mark { width: 44px; height: 44px; }
.t-pack-bar .t-pack-word { font-size: 1.5rem; }
.t-pack-bar .t-pack-logo { width: auto; gap: 14px; } .t-pack-bar .t-pack-tag { display: none; }
.t-pack-bar nav { display: flex; gap: 22px; margin-left: auto; }
.t-pack-bar nav a { color: var(--canccu-color-text-muted); text-decoration: none; font-weight: 600; }
.t-pack-bar nav a:first-child { color: var(--canccu-color-primary); }
.t-pack-hub { box-sizing: border-box; padding: 32px 40px 56px; display: grid; gap: 24px; grid-template-columns: repeat(12, 1fr); align-items: stretch; }
.t-pack-hub > section { grid-column: span 4; margin: 0; }
.t-pack-hub > .t-pack-hero { grid-column: span 8; }
.t-pack-hub h2 { margin: 0 0 14px; font-family: var(--canccu-font-heading); font-size: calc(1.375rem * var(--t-pack-h, 1)); }
.t-pack-hub .t-pack-rows li { grid-template-columns: minmax(3.5rem, max-content) 1fr auto; column-gap: 20px; font-size: 1em; padding: 6px 0; border-bottom: 1px solid var(--canccu-color-border); }
.t-pack-hub .t-pack-rows li:last-child { border-bottom: 0; }
.t-pack-hub .t-pack-where { font-size: 0.9em; }
.t-pack-hub .t-pack-big { font-size: calc(5rem * var(--t-pack-h, 1)); }
.t-pack-hub .t-pack-kicker { font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.06em; }
.t-pack-hub .t-pack-name { font-size: calc(2.25rem * var(--t-pack-h, 1)); margin: 4px 0; }
.t-pack-hub .t-pack-place { font-size: 1em; margin-bottom: 14px; }
.t-pack-hub .t-pack-food { margin: 0 0 18px; }
.t-pack-note { margin: 0 0 12px; padding-bottom: 12px; border-bottom: 1px solid var(--canccu-color-border); }
.t-pack-note:last-child { margin: 0; padding: 0; border: 0; }
.t-pack-note small { display: block; color: var(--canccu-color-text-muted); font-size: 0.9em; }
@media (max-width: 760px) {
  .t-pack-bar { padding: 12px 16px; gap: 14px; } .t-pack-bar nav { display: none; }
  .t-pack-hub { padding: 16px 16px 40px; gap: 16px; grid-template-columns: 1fr; }
  .t-pack-hub > section, .t-pack-hub > .t-pack-hero { grid-column: 1; }
  .t-pack-hub .t-pack-big { font-size: calc(3.75rem * var(--t-pack-h, 1)); }
}
`;

/** Every animation stopped at the same moment (t seconds in), so a render is the same on every run. */
export const freeze = (t = 1.2) => `*, *::before, *::after { animation-play-state: paused !important; animation-delay: -${t}s !important; }`;

export const SHEET_CSS = `
body { margin: 0; padding: 32px; background: #f4f5f9; color: #15182a; font: 16px/1.4 system-ui, sans-serif; }
body:has(.t-pack-effects) { padding: 24px; }
h1 { margin: 0 0 4px; font-size: 28px; } .t-pack-lede { margin: 0 0 24px; color: #4a5070; }
.t-pack-presets { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
.t-pack-preset { padding: 20px; background: #fff; border: 1px solid #d5d9e6; border-radius: 12px; }
.t-pack-preset h2 { margin: 0; font-size: 30px; } .t-pack-feel { margin: 2px 0 10px; color: #4a5070; }
.t-pack-facts { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 14px; padding: 0; list-style: none; }
.t-pack-facts li { padding: 2px 10px; background: #eef0f6; border-radius: 999px; font-size: 14px; }
.t-pack-new { background: #15182a !important; color: #fff; }
.t-pack-schemes { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
.t-pack-swatch { display: flex; flex-direction: column; gap: 8px; height: 132px; box-sizing: border-box; padding: 10px; border-radius: 8px; border: 1px solid #0002; }
.t-pack-swatch__card { flex: 1; padding: 6px 8px; border: 1px solid; border-radius: var(--r); font-family: var(--fh); }
.t-pack-swatch__card b { display: block; font-size: 22px; line-height: 1.1; } .t-pack-swatch__card span { font: 13px/1.2 var(--fb); }
.t-pack-swatch__pills { display: flex; gap: 6px; } .t-pack-swatch__pills i { flex: 1; height: 14px; border-radius: 999px; }
.t-pack-swatch__name { font-size: 13px; font-weight: 600; }
.t-pack-effects { display: grid; grid-template-columns: 120px repeat(4, 262px); gap: 12px 14px; align-items: start; }
.t-pack-effects h2 { margin: 0; font-size: 22px; } .t-pack-effects p { margin: 4px 0 0; font-size: 14px; color: #4a5070; }
.t-pack-frame { overflow: hidden; border-radius: 6px; border: 1px solid #c9cee0; }
.t-pack-frame iframe { width: 1920px; height: 1080px; border: 0; transform-origin: 0 0; display: block; }
.t-pack-effects ~ .t-pack-h2, .t-pack-h2 { margin: 28px 0 4px; font-size: 22px; }
.t-pack-speed { display: flex; align-items: center; gap: 12px; margin: 6px 0; } .t-pack-speed span { width: 70px; font-weight: 600; } .t-pack-speed i { height: 14px; border-radius: 7px; background: #b0189a; } .t-pack-speed b { font-weight: 500; color: #4a5070; }
.t-pack-font { margin: 0 0 16px; padding: 16px 20px; background: #fff; border: 1px solid #d5d9e6; border-radius: 12px; } .t-pack-font--yes { border: 3px solid #1a7f4b; }
.t-pack-font header { display: flex; justify-content: space-between; align-items: baseline; } .t-pack-font h2 { margin: 0; font-size: 22px; }
.t-pack-digits, .t-pack-sample { margin: 8px 0; padding: 10px 16px; background: #0b0b1a; color: #fff; line-height: 1.3; }
.t-pack-col { font-weight: 700; text-align: center; }
`;
