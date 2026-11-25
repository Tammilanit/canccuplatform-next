// Builds the theme studio pack's sheets (#784, plan Part 0) with no hand drawing: each sheet is
// one self-contained HTML page (packages/ui's ui.css, the presets' real colours, the fonts as data
// URIs), rendered by Chromium to the PNGs docs/design/theme-studio.md lists.
// Usage: node build.mjs [--html DIR] [--fonts DIR]   write the HTML (fetches the fonts once)
//        node build.mjs --render [--html DIR]          render the PNGs next to this file (needs
//                                                      playwright-core; run it in the Playwright
//                                                      image, see the pack's README section)
// The HTML stays out of the repo: it carries about 1 MB of embedded fonts and is rebuilt exactly.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { FONT_PAIRS, PRESETS, ROOT, checkSchemes } from "./data.mjs";
import { vars } from "./parts.mjs";
import { SHEET_CSS } from "./style.mjs";
import { makeItYours, pickALook, platesEverywhere } from "./sheets-look.mjs";
import { actionsAndStates, advanced } from "./sheets-advanced.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every sheet and the widths it is rendered at (plan Part 0). */
export const SHEETS = [
  { file: "01-pick-a-look", widths: [1280, 1920, 390], body: pickALook },
  { file: "02-make-it-yours", widths: [1280, 1920, 390], body: makeItYours },
  { file: "03-logo-plates", widths: [1280], body: platesEverywhere },
  { file: "04-advanced", widths: [1280, 1920, 390], body: advanced },
  { file: "05-actions-and-states", widths: [1280], body: actionsAndStates },
];

/** The faces the sheets draw: every pair's heading and body, and the presets' own fonts. */
function faces() {
  const want = new Map();
  const add = (family, weight) => family !== "system-ui" && want.set(`${family}|${weight}`, { family, weight });
  for (const p of FONT_PAIRS) add(p.heading, p.hw), add(p.body, p.bw);
  for (const p of PRESETS) add(p.fonts.heading, 700), add(p.fonts.body, 400);
  return [...want.values()];
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/** One face's Latin WOFF2 from Google Fonts (every family listed is SIL OFL there), cached in `dir`. */
async function fetchFace(dir, { family, weight }) {
  const file = join(dir, `${slug(family)}-${weight}.woff2`);
  if (existsSync(file)) return readFileSync(file);
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`, { headers: { "User-Agent": UA } })).text();
  const latin = css.split("/* latin */")[1] ?? css;
  const url = latin.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
  if (!url) throw new Error(`no WOFF2 for ${family} ${weight}`);
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  if (bytes.subarray(0, 4).toString() !== "wOF2") throw new Error(`not a WOFF2: ${family} ${weight}`);
  writeFileSync(file, bytes);
  return bytes;
}

async function fontCss(dir) {
  mkdirSync(dir, { recursive: true });
  const rules = [];
  for (const f of faces()) {
    const b64 = (await fetchFace(dir, f)).toString("base64");
    rules.push(`@font-face{font-family:"${f.family}";font-weight:${f.weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2")}`);
  }
  return rules.join("\n");
}

export function page(body, fonts) {
  const ui = readFileSync(join(ROOT, "packages/ui/ui.css"), "utf8");
  // The organiser pages take the event's colours (Default, Night: the demo event's look).
  const admin = `:root{${vars(PRESETS[0].schemes[0].colors)}}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Theme studio pack</title><style>${ui}\n${fonts}\n${admin}\n${SHEET_CSS}</style></head><body class="canccu-page canccu-surface canccu-surface--admin">${body}</body></html>`;
}

async function writeHtml(htmlDir, fontsDir) {
  checkSchemes();
  const fonts = await fontCss(fontsDir);
  mkdirSync(htmlDir, { recursive: true });
  for (const s of SHEETS) for (const w of s.widths) writeFileSync(join(htmlDir, `${s.file}-${w}.html`), page(s.body(w), fonts));
  console.log(`wrote ${SHEETS.reduce((n, s) => n + s.widths.length, 0)} sheets to ${htmlDir}`);
}

async function render(htmlDir) {
  const require = createRequire(join(process.env.CANCCU_PLAYWRIGHT_DIR ?? process.cwd(), "noop.js"));
  const { chromium } = require("playwright-core");
  const browser = await chromium.launch();
  try {
    for (const name of readdirSync(htmlDir).filter((f) => f.endsWith(".html")).sort()) {
      const w = Number(name.match(/-(\d+)\.html$/)[1]);
      const pg = await browser.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
      await pg.goto(pathToFileURL(join(htmlDir, name)).href);
      await pg.evaluate(() => document.fonts.ready);
      // The render check of the mockup rules: text wider than its box is clipped or overlaps.
      const clipped = await pg.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((el) => el.closest(".frame") === null && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible" && el.clientWidth > 0)
          .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
      );
      const wide = await pg.evaluate(() => document.documentElement.scrollWidth);
      if (wide > w) clipped.push(`the page is ${wide} px wide`);
      if (clipped.length) console.warn(`${name}: ${clipped.slice(0, 8).join(", ")}`);
      await pg.screenshot({ path: join(HERE, name.replace(/\.html$/, ".png")), fullPage: true });
      await pg.close();
    }
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { html: { type: "string" }, fonts: { type: "string" }, render: { type: "boolean" } } });
  const htmlDir = values.html ?? join(process.env.TMPDIR ?? tmpdir(), "theme-studio-html");
  if (values.render) await render(htmlDir);
  else await writeHtml(htmlDir, values.fonts ?? join(process.env.TMPDIR ?? tmpdir(), "theme-studio-fonts"));
}
