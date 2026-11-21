// The pack page's look (#718): tokens first, dark by default with the values of packages/ui's
// default theme, light when the reader's system asks for it. One column that reads at 390 px;
// wide tables scroll inside their box instead of widening the page.
export const PAGE_CSS = `
:root {
  color-scheme: dark light;
  --canccu-page-background: #0f172a;
  --canccu-page-surface: #1e293b;
  --canccu-page-border: #334155;
  --canccu-page-text: #f8fafc;
  --canccu-page-muted: #94a3b8;
  --canccu-page-link: #93c5fd;
  --canccu-page-accent: #f59e0b;
  --canccu-page-font: system-ui, sans-serif;
  --canccu-page-mono: ui-monospace, monospace;
  --canccu-page-gap: 1rem;
  --canccu-page-radius: 0.5rem;
}
@media (prefers-color-scheme: light) {
  :root {
    --canccu-page-background: #f8fafc;
    --canccu-page-surface: #ffffff;
    --canccu-page-border: #cbd5e1;
    --canccu-page-text: #0f172a;
    --canccu-page-muted: #475569;
    --canccu-page-link: #1d4ed8;
    --canccu-page-accent: #b45309;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--canccu-page-background);
  color: var(--canccu-page-text);
  font: 1rem/1.55 var(--canccu-page-font);
}
main { max-width: 80rem; margin: 0 auto; padding: var(--canccu-page-gap); }
@media (min-width: 48rem) { main { padding: calc(var(--canccu-page-gap) * 2); } }
h1 { font-size: clamp(1.6rem, 4vw, 2.4rem); line-height: 1.2; margin: 0 0 var(--canccu-page-gap); }
h2 { margin-top: 2.5rem; padding-top: 0.5rem; border-top: 1px solid var(--canccu-page-border); }
h2, h3, h4 { line-height: 1.25; scroll-margin-top: var(--canccu-page-gap); }
figure { scroll-margin-top: var(--canccu-page-gap); }
a { color: var(--canccu-page-link); overflow-wrap: anywhere; }
p, li { max-width: 75ch; }
code { font-family: var(--canccu-page-mono); font-size: 0.9em; background: var(--canccu-page-surface); padding: 0.1em 0.3em; border-radius: 0.25rem; overflow-wrap: anywhere; }
pre { background: var(--canccu-page-surface); padding: var(--canccu-page-gap); border-radius: var(--canccu-page-radius); overflow-x: auto; }
pre code { padding: 0; background: none; }
blockquote { margin: var(--canccu-page-gap) 0; padding: 0 var(--canccu-page-gap); border-left: 4px solid var(--canccu-page-accent); color: var(--canccu-page-muted); }
hr { border: 0; border-top: 1px solid var(--canccu-page-border); }
img { max-width: 100%; height: auto; }
.table { overflow-x: auto; margin: var(--canccu-page-gap) 0; }
table { border-collapse: collapse; min-width: 100%; }
th, td { border: 1px solid var(--canccu-page-border); padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
th { background: var(--canccu-page-surface); }
td img { width: 100%; min-width: 12rem; }
nav, .verdict { background: var(--canccu-page-surface); border-radius: var(--canccu-page-radius); padding: var(--canccu-page-gap); margin: var(--canccu-page-gap) 0; }
.verdict { border-left: 4px solid var(--canccu-page-accent); }
.verdict > :first-child { margin-top: 0; }
.verdict > :last-child { margin-bottom: 0; }
.nav-title { margin: 0; font-weight: 700; }
nav ol { margin: 0.5rem 0 0; padding-left: 1.4rem; }
nav ul { padding-left: 1.2rem; font-size: 0.95em; }
.sheets figure { margin: 2rem 0; }
.sheets img { display: block; width: 100%; border: 1px solid var(--canccu-page-border); border-radius: var(--canccu-page-radius); }
figcaption { margin-top: 0.5rem; color: var(--canccu-page-muted); }
.sheet-link { font-weight: 600; }
`;
