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
  .canccu-layout { position: absolute; inset: var(--canccu-safe-inset); display: grid;
    grid-template-columns: repeat(24, 1fr); grid-template-rows: repeat(12, 1fr); gap: var(--canccu-gap); }
  .canccu-region { display: flex; flex-direction: column; gap: var(--canccu-gap); min-height: 0; min-width: 0; }
  .canccu-region > .canccu-widget { flex: 1; }
  .canccu-widget { position: relative; box-sizing: border-box; height: 100%; min-height: 0; padding: 22px 28px; overflow: hidden;
    background: var(--canccu-color-surface); border: var(--canccu-border-width) solid var(--canccu-color-border); border-radius: var(--canccu-radius); }
  .canccu-widget__title { margin: 0 0 14px; font-family: var(--canccu-font-heading); font-size: 1.75rem; font-weight: 700;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--canccu-color-text-muted); }
  .canccu-widget__body { margin: 0; }
  .canccu-widget--logo, .canccu-widget--clock { display: flex; align-items: center; }
  .canccu-widget--logo img { height: 64px; }
  .canccu-widget--ticker { display: flex; align-items: center; padding: 0 28px; white-space: nowrap; }
  .canccu-widget--announcement { display: flex; flex-direction: column; justify-content: center; padding: 64px 96px; }
  .canccu-widget--announcement .canccu-widget__title { font-size: 4.5rem; letter-spacing: 0.02em; text-transform: none; color: var(--canccu-color-text); }
  .canccu-widget--announcement .canccu-widget__body { font-size: 2.5rem; color: var(--canccu-color-text-muted); }
}
.t-pack-clock { margin-left: auto; font-family: var(--canccu-font-heading); font-size: 3rem; font-weight: 700; text-align: right; line-height: 1; }
.t-pack-clock small { display: block; font-size: 1.75rem; font-weight: 400; color: var(--canccu-color-text-muted); }
.canccu-region--_full > .canccu-widget { display: flex; flex-direction: column; }
.canccu-region--_full .canccu-widget--countdown .canccu-widget__body { flex: 1; display: flex; flex-direction: column; justify-content: center; }
.canccu-region--_full .t-pack-big { font-size: 15rem; }
.canccu-region--_full .t-pack-kicker { font-size: 3rem; }
.t-pack-food strong { color: var(--canccu-color-status-ok); }
`;

export const HUB_BASE = `${SHARED}
body.canccu-surface--hub { margin: 0; }
.t-pack-hub { box-sizing: border-box; max-width: 1120px; margin: 0 auto; padding: 24px 16px 48px;
  display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); align-items: start; }
.t-pack-hub h2 { font-family: var(--canccu-font-heading); }
.t-pack-hub .t-pack-rows li { grid-template-columns: 3.5rem 1fr auto; font-size: 1rem; }
.t-pack-hub .t-pack-rows .t-pack-where { font-size: 0.875rem; }
.t-pack-hero { grid-column: 1 / -1; }
.t-pack-hero .t-pack-big { font-size: 3.5rem; }
.t-pack-hero .t-pack-kicker { font-size: 1.125rem; }
`;

/** Every animation stopped at the same moment, so a render is the same on every run. */
export const FREEZE = `*, *::before, *::after { animation-play-state: paused !important; animation-delay: -1.2s !important; }`;

export const SHEET_CSS = `
body { margin: 0; padding: 32px; background: #f4f5f9; color: #15182a; font: 16px/1.4 system-ui, sans-serif; }
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
.t-pack-effects { display: grid; grid-template-columns: 140px repeat(3, 336px); gap: 12px 16px; align-items: start; }
.t-pack-effects h2 { margin: 0; font-size: 22px; } .t-pack-effects p { margin: 4px 0 0; font-size: 14px; color: #4a5070; }
.t-pack-frame { width: 336px; height: 189px; overflow: hidden; border-radius: 6px; border: 1px solid #c9cee0; }
.t-pack-frame iframe { width: 1920px; height: 1080px; border: 0; transform: scale(0.175); transform-origin: 0 0; }
.t-pack-col { font-weight: 700; text-align: center; }
`;
