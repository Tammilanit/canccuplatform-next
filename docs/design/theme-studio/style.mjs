// The sheets' own CSS (#784): the scaled previews and the studio's new controls, on top of
// packages/ui's ui.css, which every sheet inlines. Values reuse ui.css's tokens and inks.
export const SHEET_CSS = `
body { margin: 0; }
.up { transform: rotate(180deg); }
.savestate { display: inline-flex; gap: .35rem; align-items: center; color: var(--canccu-ink-muted); font-size: var(--canccu-text-sm); margin-right: .5rem; }
.studio { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2rem; align-items: start; margin-top: 1.25rem; }
.studio > .pv { position: sticky; top: 1rem; }
.sec { padding: 0 0 1.5rem; margin: 0 0 1.5rem; border-bottom: 1px solid var(--canccu-color-border); }
.sec:last-child { border-bottom: 0; }
.sec h2 { font-size: var(--canccu-text-lg); margin: 0 0 .25rem; }
.sec > p.hint { color: var(--canccu-ink-muted); margin: 0 0 1rem; font-size: var(--canccu-text-sm); }
.lbl { display: block; font-weight: 600; font-size: var(--canccu-text-sm); margin: 1rem 0 .5rem; }
.row { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
.opt { display: inline-flex; flex-direction: column; align-items: center; gap: .4rem; padding: .6rem .7rem; border: 1px solid var(--canccu-color-border); border-radius: var(--canccu-radius); background: var(--canccu-color-surface); color: var(--canccu-color-text); font: inherit; font-size: var(--canccu-text-sm); min-width: 5.4rem; }
.opt[aria-pressed="true"] { border-color: var(--canccu-color-primary); box-shadow: 0 0 0 2px var(--canccu-color-primary); }
.opt .tile.tile--wide { width: 5.6rem; }
.opt .tile { width: 4.4rem; height: 2.5rem; border-radius: calc(var(--canccu-radius) * .75); display: grid; place-items: center; }
.pill { display: inline-flex; gap: .35rem; align-items: center; padding: .45rem .85rem; border: 1px solid var(--canccu-color-border); border-radius: 999px; background: var(--canccu-color-surface); color: var(--canccu-color-text); font: inherit; font-size: var(--canccu-text-sm); }
.pill[aria-pressed="true"] { background: var(--canccu-color-primary); color: var(--canccu-color-primary-text); border-color: var(--canccu-color-primary); font-weight: 600; }
.plate { display: inline-grid; place-items: center; line-height: 0; box-sizing: border-box; }
.plate img { display: block; }
.advice { display: flex; gap: .75rem; align-items: flex-start; padding: .85rem 1rem; border-radius: var(--canccu-radius); background: color-mix(in srgb, var(--canccu-color-status-degraded) 14%, var(--canccu-color-surface)); border: 1px solid color-mix(in srgb, var(--canccu-color-status-degraded) 45%, transparent); margin: 1rem 0; }
.advice p { margin: 0 0 .5rem; }
.logobox { display: flex; gap: 1rem; align-items: center; }
.logobox__ground { width: 13rem; height: 6.5rem; border-radius: var(--canccu-radius); display: grid; place-items: center; border: 1px dashed var(--canccu-color-border); }
.swatch { width: 2.25rem; height: 2.25rem; border-radius: 999px; border: 2px solid var(--canccu-color-border); display: inline-block; }
.swatch--big { width: 3rem; height: 3rem; border-radius: var(--canccu-radius); }
.swatch[aria-pressed="true"] { outline: 3px solid var(--canccu-color-primary); outline-offset: 2px; }
.colour { display: grid; grid-template-columns: auto 1fr; gap: .25rem 1rem; align-items: center; margin-bottom: 1rem; }
.colour small { color: var(--canccu-ink-muted); }
.pairs { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.6rem, 1fr)); gap: .4rem; }
.pair { text-align: left; padding: .45rem .6rem; border: 1px solid var(--canccu-color-border); border-radius: var(--canccu-radius); background: var(--canccu-color-surface); color: var(--canccu-color-text); }
.pair[aria-pressed="true"] { border-color: var(--canccu-color-primary); box-shadow: 0 0 0 2px var(--canccu-color-primary); }
.pair b { display: block; font-size: 1.05rem; line-height: 1.2; }
.pair span { display: block; font-size: .72rem; color: var(--canccu-ink-muted); margin-top: .1rem; }
.foot { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
.foot .grow { flex: 1; }
.preset { margin-bottom: 1.75rem; }
.preset__head { display: flex; align-items: baseline; gap: .75rem; margin-bottom: .6rem; }
.preset__head h2 { margin: 0; font-size: var(--canccu-text-lg); }
.preset__head span { color: var(--canccu-ink-muted); font-size: var(--canccu-text-sm); }
.thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--thumb, 200px), 1fr)); gap: .75rem; }
.thumb { display: flex; flex-direction: column; gap: .3rem; padding: .4rem; border: 1px solid var(--canccu-color-border); border-radius: var(--canccu-radius); background: var(--canccu-color-surface); color: var(--canccu-color-text); font: inherit; text-align: left; }
.thumb--chosen { border-color: var(--canccu-color-primary); box-shadow: 0 0 0 2px var(--canccu-color-primary); }
.thumb__svg { width: 100%; height: auto; border-radius: calc(var(--canccu-radius) * .6); display: block; }
.thumb__name { font-weight: 600; font-size: var(--canccu-text-sm); display: flex; gap: .3rem; align-items: center; }
.thumb__kind { font-size: var(--canccu-text-xs); color: var(--canccu-ink-muted); }
.empty-row { padding: 1.25rem; border: 1px dashed var(--canccu-color-border); border-radius: var(--canccu-radius); color: var(--canccu-ink-muted); display: flex; gap: 1rem; align-items: center; justify-content: space-between; }
.pv { display: flex; flex-direction: column; gap: .75rem; }
.pv__head { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
.pv__state { display: inline-flex; gap: .3rem; align-items: center; color: var(--canccu-ink-muted); font-size: var(--canccu-text-xs); }
.pv figure { margin: 0; }
.pv figcaption { font-size: var(--canccu-text-xs); color: var(--canccu-ink-muted); margin-top: .3rem; }
.pv__states { display: grid; gap: .35rem; }
.pv__states .row { gap: .3rem; }
.pv__lbl { font-size: var(--canccu-text-xs); color: var(--canccu-ink-muted); width: 5.2rem; flex: none; }
.pill--sm { padding: .25rem .65rem; font-size: var(--canccu-text-xs); }
.pv__row { display: flex; gap: 16px; align-items: flex-start; }
.frame { position: relative; overflow: hidden; border-radius: 8px; border: 1px solid var(--canccu-color-border); box-shadow: var(--canccu-shadow); }
.mini { border-radius: 8px; border: 1px solid var(--canccu-color-border); box-shadow: var(--canccu-shadow); }
.frame--phone { border-radius: 14px; border-width: 3px; }
.frame > div { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
.kick { text-transform: uppercase; letter-spacing: .08em; font-weight: 700; margin: 0; }
.muted { margin: 0; }
.scr { width: 960px; height: 540px; display: grid; grid-template: 64px 1fr 1fr 46px / 2fr 1fr; gap: 14px; padding: 18px 22px 0; box-sizing: border-box; }
.scr__head { grid-column: 1 / -1; display: flex; align-items: center; gap: 18px; font-size: 26px; }
.scr__clock { margin-left: auto; font-size: 30px; font-weight: 700; }
.scr__hero { grid-row: 2 / 4; padding: 26px 30px; display: flex; flex-direction: column; gap: 6px; }
.scr__hero .kick { font-size: 20px; } .scr__hero .big { font-size: 54px; font-weight: 800; margin: 0; line-height: 1.05; }
.scr__hero .count { font-size: 130px; font-weight: 800; margin: 4px 0 0; line-height: 1; } .scr__hero .muted { font-size: 22px; }
.scr__rail { padding: 18px 22px; } .scr__rail .kick { font-size: 16px; } .scr__rail .mid { font-size: 38px; font-weight: 800; margin: 6px 0; } .scr__rail .muted { font-size: 18px; }
.scr__venue { padding: 16px 20px; display: flex; gap: 16px; align-items: center; font-size: 18px; }
.qr { width: 84px; height: 84px; border-radius: 6px; flex: none; background-image: repeating-conic-gradient(#000c 0 25%, transparent 0 50%); background-size: 14px 14px; border: 6px solid transparent; background-clip: content-box; }
.scr__ticker { grid-column: 1 / -1; margin: 0 -22px; display: flex; gap: 16px; align-items: center; padding: 0 22px; font-size: 20px; }
.tag { padding: 3px 10px; border-radius: 4px; font-weight: 700; font-size: 16px; text-transform: uppercase; }
.ph { width: 390px; height: 844px; display: flex; flex-direction: column; font-size: 16px; }
.ph__head { display: flex; gap: 12px; align-items: center; padding: 14px 16px; }
.ph__hero { padding: 22px 18px 10px; } .ph__hero .kick { font-size: 13px; } .ph__hero .big { font-size: 46px; font-weight: 800; margin: 2px 0; } .ph__hero p { margin: 0 0 4px; }
.ph__btn { display: inline-block; margin-top: 14px; padding: 12px 18px; font-weight: 700; }
.ph__card { margin: 8px 16px; padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
.ph__bar { margin-top: auto; display: flex; justify-content: space-around; padding: 18px 0 26px; font-size: 14px; }
.hp { width: 1280px; height: 800px; font-size: 18px; }
.hp__head { display: flex; gap: 28px; align-items: center; padding: 16px 40px; font-size: 18px; } .hp__head b { margin-right: auto; font-size: 22px; }
.hp__body { display: grid; grid-template-columns: 1.2fr 1fr; gap: 28px; padding: 40px; }
.hp__hero .kick { font-size: 16px; } .hp__hero .big { font-size: 76px; font-weight: 800; margin: 6px 0; } .hp__hero p { margin: 0 0 6px; }
.hp__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.hp__tile { padding: 20px; display: flex; flex-direction: column; gap: 6px; min-height: 120px; }
.cap { font-size: var(--canccu-text-xs); color: var(--canccu-ink-muted); margin: .4rem 0 0; }
.sheet-note { max-width: 70rem; margin: 2rem auto 3rem; padding: 0 1.5rem; color: var(--canccu-ink-muted); font-size: var(--canccu-text-sm); }
.groups { margin: 1.25rem 0 1.5rem; }
.toks { display: grid; grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr)); gap: .5rem 1.5rem; }
.tok { display: flex; flex-wrap: wrap; gap: .85rem; align-items: center; padding: .5rem 0; }
.tok small { color: var(--canccu-ink-muted); }
.tok > .canccu-badge, .tok > .fontpick, .tok > .canccu-button { margin-left: auto; }
.tok--slider, .tok--pills { flex-direction: column; flex-wrap: nowrap; align-items: stretch; gap: .5rem; }
.range { display: flex; gap: .75rem; align-items: center; }
.range input { flex: 1; accent-color: var(--canccu-color-primary); }
.range output { min-width: 3.5rem; text-align: right; font-variant-numeric: tabular-nums; }
.info { border: 0; background: none; color: var(--canccu-ink-muted); padding: 0; vertical-align: middle; }
.tip { box-sizing: border-box; flex-basis: calc(100% - 3.85rem); min-width: 0; margin-left: 3.85rem; padding: .7rem .85rem; border-radius: var(--canccu-radius); background: var(--canccu-raised); border: 1px solid var(--canccu-color-border); box-shadow: var(--canccu-shadow); font-size: var(--canccu-text-sm); }
.tok--slider .tip { margin-left: 0; flex-basis: 100%; }
.groups .pill { text-decoration: none; }
.fontpick { display: inline-flex; gap: .5rem; align-items: center; padding: .45rem .75rem; border: 1px solid var(--canccu-color-border); border-radius: var(--canccu-radius); background: var(--canccu-color-surface); color: var(--canccu-color-text); font-size: 1.05rem; }
.bgpic { width: 5rem; height: 2.8rem; border-radius: calc(var(--canccu-radius) * .75); flex: none; }
.ed { border: 1px solid var(--canccu-color-border); border-radius: var(--canccu-radius); background: var(--canccu-color-background); padding: .5rem 0; font-family: var(--canccu-font-mono); font-size: .85rem; overflow-x: auto; }
.ed__line { display: flex; gap: .75rem; padding: 0 .75rem; line-height: 1.6; white-space: pre; }
.ed__no { width: 1.5rem; text-align: right; color: var(--canccu-ink-muted); flex: none; }
.ed__line--error { background: color-mix(in srgb, var(--canccu-color-status-down) 16%, transparent); }
.ed__line--error code { text-decoration: underline wavy var(--canccu-color-status-down); }
.ed__line--warning { background: color-mix(in srgb, var(--canccu-color-status-degraded) 14%, transparent); }
.ed__line--warning code { text-decoration: underline wavy var(--canccu-color-status-degraded); }
.problems { list-style: none; padding: 0; margin: .75rem 0; display: grid; gap: .4rem; font-size: var(--canccu-text-sm); }
.problems li { display: flex; gap: .5rem; align-items: flex-start; }
.problems--error .canccu-i { color: var(--canccu-ink-down); }
.problems--warn .canccu-i { color: var(--canccu-ink-degraded); }
.states { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
.state { margin: 0; }
.state figcaption { font-size: var(--canccu-text-xs); color: var(--canccu-ink-muted); margin-top: .5rem; }
.dlg { background: var(--canccu-color-surface); border: 1px solid var(--canccu-color-border); border-radius: calc(var(--canccu-radius) * 1.5); padding: 1.25rem; box-shadow: var(--canccu-shadow); }
.dlg h3 { margin: 0 0 .5rem; font-size: var(--canccu-text-lg); }
.dlg p { margin: 0 0 1rem; color: var(--canccu-ink-muted); }
.dlg .canccu-field { margin-bottom: 1rem; }
.drop { display: flex; flex-direction: column; align-items: center; gap: .4rem; text-align: center; padding: 1.5rem 1rem; border: 2px dashed var(--canccu-color-border); border-radius: var(--canccu-radius); margin-bottom: 1rem; color: var(--canccu-ink-muted); }
.drop b { color: var(--canccu-color-text); }
.sw { display: grid; grid-template-columns: auto 1fr; gap: .15rem .75rem; align-items: start; margin: 0 0 .75rem; }
.sw .canccu-switch { grid-row: span 2; margin-top: .15rem; }
.sw small { color: var(--canccu-ink-muted); }
.cap--note { display: flex; gap: .5rem; align-items: flex-start; color: var(--canccu-ink-muted); font-size: var(--canccu-text-sm); margin: 1rem 0 0; }
.opt--multi { position: relative; }
.opt--multi .tick { position: absolute; top: .3rem; right: .3rem; width: 1.15rem; height: 1.15rem; border-radius: 4px; background: var(--canccu-color-primary); color: var(--canccu-color-primary-text); display: grid; place-items: center; font-size: .7rem; }
.opt--multi[aria-pressed="false"] .tick { background: var(--canccu-color-surface); border: 1px solid var(--canccu-color-border); color: transparent; }
.lane { margin-bottom: 1.75rem; }
.lane h2 { font-size: var(--canccu-text-lg); margin: 0 0 .15rem; }
.lane > p { color: var(--canccu-ink-muted); margin: 0 0 .75rem; font-size: var(--canccu-text-sm); max-width: 60rem; }
.lane__row { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
.lane__row figure { margin: 0; }
.lane__row figcaption { font-size: var(--canccu-text-xs); color: var(--canccu-ink-muted); margin-top: .3rem; }
.lane__arrow { color: var(--canccu-ink-muted); flex: none; }
.h2 { font-size: var(--canccu-text-lg); margin: 2rem 0 .75rem; }
@media (max-width: 700px) {
  /* A full-page shot would paint the fixed bar over the middle of the page: here it closes the page. */
  .canccu-tabbar { position: static !important; }
  .toks { grid-template-columns: minmax(0, 1fr); }
  .studio { grid-template-columns: minmax(0, 1fr); gap: 1.25rem; }
  .studio > .pv { order: -1; position: static; }
  .canccu-pagehead .canccu-cluster .canccu-button--secondary { display: none; }
  .pairs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ed__line { white-space: pre-wrap; overflow-wrap: anywhere; }
}
`;
