// Builds the Themes pack's sheets (#785, plan Part 0) with no hand drawing: every render is an
// HTML document (frames.mjs, sheets.mjs) on packages/ui's ui.css with the presets' real colours,
// their font pairs' own files and the advanced looks' CSS, rendered by Chromium to the PNGs
// docs/design/themes.md lists. The HTML stays out of the repo; it is rebuilt exactly.
// Usage: node build.mjs --check-only           check the schemes against the preset rules
//        node build.mjs [--html DIR]           write the HTML (to $TMPDIR/themes-html)
//        node build.mjs --render [--html DIR]  render the PNGs next to this file (needs
//                                              playwright-core; run it in the Playwright image,
//                                              see docs/design/themes.md, Rebuild)
//        node build.mjs --clips [--html DIR]   write the effects clips (GIF, needs gifenc and pngjs:
//                                              CANCCU_GIF_DIR names a folder with both installed)
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { GALLERY, checkSchemes } from "./data.mjs";
import { hubDoc, screenDoc } from "./frames.mjs";
import { FX, LEVELS, effects, fonts, overview } from "./sheets.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The scheme each view shows: the first, the other brightness, and a colour variant. */
const other = (p) => p.schemes.find((s) => s.kind === (p.schemes[0].kind === "light" ? "dark" : "light"));
const variant = (p) => p.schemes[1];

/** Every render: its file name (with its width), its document and whether it is one screen tall. */
export function renders() {
  const out = [{ name: "00-overview-1920", doc: overview() }];
  GALLERY.filter((p) => !p.existing).forEach((p, i) => {
    const n = String(i + 1).padStart(2, "0");
    out.push(
      { name: `${n}-${p.id}-hero-1920`, doc: screenDoc(p, p.schemes[0], "hero", "calm"), screen: true },
      { name: `${n}-${p.id}-rail-1920`, doc: screenDoc(p, other(p), "rail", "calm"), screen: true },
      { name: `${n}-${p.id}-announcement-1920`, doc: screenDoc(p, variant(p), "announcement", "lively"), screen: true },
      { name: `${n}-${p.id}-hub-1280`, doc: hubDoc(p, p.schemes[0]) },
      { name: `${n}-${p.id}-phone-390`, doc: hubDoc(p, p.schemes[0]) },
    );
  });
  out.push({ name: "06-effects-1280", doc: effects() }, { name: "07-arcade-fonts-1280", doc: fonts() });
  return out;
}

/** The frames the effects sheet holds: each advanced look's hero at four levels, frozen in its motion. */
function effectFrames() {
  return GALLERY.filter((p) => p.css).flatMap((p) =>
    LEVELS.map((lvl) => ({ name: `fx-${p.id}-${lvl}`, doc: screenDoc(p, p.schemes[0], "hero", lvl, FX[p.id].t[lvl]) })),
  );
}

function writeHtml(dir) {
  console.log(`${checkSchemes()} new schemes pass`);
  mkdirSync(dir, { recursive: true });
  for (const r of [...renders(), ...effectFrames()]) writeFileSync(join(dir, `${r.name}.html`), r.doc);
  console.log(`wrote ${renders().length} sheets to ${dir}`);
}

async function render(dir) {
  const require = createRequire(join(process.env.CANCCU_PLAYWRIGHT_DIR ?? process.cwd(), "noop.js"));
  const { chromium } = require("playwright-core");
  const browser = await chromium.launch();
  const screens = new Set(renders().filter((r) => r.screen).map((r) => r.name));
  try {
    for (const file of readdirSync(dir).filter((f) => /^\d.*\.html$/.test(f)).sort()) {
      const name = file.replace(/\.html$/, "");
      const w = Number(name.match(/-(\d+)$/)[1]);
      const pg = await browser.newPage({ viewport: { width: w, height: screens.has(name) ? 1080 : 900 }, deviceScaleFactor: 1 });
      await pg.goto(pathToFileURL(join(dir, file)).href);
      await pg.evaluate(() => document.fonts.ready);
      for (const f of pg.frames()) await f.evaluate(() => document.fonts.ready);
      // The render check of the mockup rules: text wider than its box is clipped or overlaps.
      const clipped = await pg.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((el) => !el.closest(".t-pack-frame") && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible" && el.clientWidth > 0 && !el.matches(".canccu-stage, .canccu-widget--ticker, .canccu-widget--ticker *"))
          .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
      );
      const wide = await pg.evaluate(() => document.documentElement.scrollWidth);
      if (wide > w) clipped.push(`the page is ${wide} px wide`);
      if (clipped.length) console.warn(`${name}: ${clipped.slice(0, 8).join(", ")}`);
      await pg.screenshot({ path: join(HERE, `${name}.png`), fullPage: !screens.has(name) });
      await pg.close();
    }
  } finally {
    await browser.close();
  }
}

/** One GIF a look: the four levels side by side, 3 s at 8 frames a second, each frame set to its
 *  moment with the Web Animations API, so the clip is the same on every run. */
async function clips(dir) {
  const need = createRequire(join(process.env.CANCCU_GIF_DIR ?? process.cwd(), "noop.js"));
  const { GIFEncoder, quantize, applyPalette } = need("gifenc");
  const { PNG } = need("pngjs");
  const pw = createRequire(join(process.env.CANCCU_PLAYWRIGHT_DIR ?? process.cwd(), "noop.js"));
  const browser = await pw("playwright-core").chromium.launch();
  const W = 262;
  try {
    for (const p of GALLERY.filter((x) => x.css)) {
      const [cx, cy, cw, ch] = FX[p.id].crop;
      const scale = W / cw;
      const H = Math.round(ch * scale);
      const pages = [];
      for (const lvl of LEVELS) {
        const file = join(dir, `clip-${p.id}-${lvl}.html`);
        writeFileSync(file, screenDoc(p, p.schemes[0], "hero", lvl, 0));
        const pg = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
        await pg.goto(pathToFileURL(file).href);
        await pg.evaluate(() => document.fonts.ready);
        await pg.evaluate(() => document.head.lastElementChild.remove());
        pages.push(pg);
      }
      const gif = GIFEncoder();
      for (let f = 0; f < 24; f++) {
        const out = new PNG({ width: W * 2 + 6, height: H * 2 + 6 });
        out.data.fill(255);
        for (const [i, pg] of pages.entries()) {
          await pg.evaluate((ms) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ms; }), (f / 8) * 1000);
          const shot = PNG.sync.read(await pg.screenshot({ clip: { x: cx, y: cy, width: cw, height: ch } }));
          PNG.bitblt(shot, out, 0, 0, Math.min(W, shot.width), Math.min(H, shot.height), (i % 2) * (W + 6), Math.floor(i / 2) * (H + 6));
        }
        const palette = quantize(out.data, 64);
        gif.writeFrame(applyPalette(out.data, palette), out.width, out.height, { palette, delay: 125 });
      }
      gif.finish();
      writeFileSync(join(HERE, `06-effects-${p.id}-clip.gif`), gif.bytes());
      await Promise.all(pages.map((pg) => pg.close()));
    }
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { html: { type: "string" }, render: { type: "boolean" }, clips: { type: "boolean" }, "check-only": { type: "boolean" } } });
  const dir = values.html ?? join(process.env.TMPDIR ?? tmpdir(), "themes-html");
  if (values["check-only"]) console.log(`${checkSchemes()} new schemes pass`);
  else if (values.render) await render(dir);
  else if (values.clips) await clips(dir);
  else writeHtml(dir);
}
