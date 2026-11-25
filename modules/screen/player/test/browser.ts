/**
 * The player in a real browser (#779): what happy-dom cannot show, because it lays nothing out
 * (a glyph's ink against its box, a crawl's wrap, a region's place through a theme change). The
 * page holds the player's own CSS and `Screen`, bundled as `npm run build` bundles them, and draws
 * the states it is handed with the server's clock it is given.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";

const SRC = new URL("../src/", import.meta.url);
const THEMES = new URL("../../../../events/demo/themes/", import.meta.url);

/** Playwright's bundled Chromium, else the runner's Chrome; undefined when neither starts. */
export async function launch(): Promise<Browser | undefined> {
  for (const options of [{}, { channel: "chrome" }]) {
    try {
      return await chromium.launch(options);
    } catch {
      // Try the next one.
    }
  }
  if (process.env.CI) throw new Error("no Chromium or Chrome for the browser tests");
  return undefined;
}

export interface Bundle {
  css: string;
  js: string;
}

/** The style sheets in main.ts's order, so the page has the cascade a screen has. */
export async function bundle(): Promise<Bundle> {
  const main = await readFile(new URL("main.ts", SRC), "utf8");
  const sheets = [...main.matchAll(/^import "(\.\/[\w-]+\.css)";$/gm)].map((m) => m[1]);
  const out = await build({
    stdin: {
      contents: [
        ...sheets.map((s) => `import "${String(s)}";`),
        'export { Screen } from "./screen.js";',
      ].join("\n"),
      resolveDir: fileURLToPath(SRC),
      loader: "ts",
      sourcefile: "browser-test.ts",
    },
    bundle: true,
    format: "iife",
    globalName: "canccuPlayer",
    write: false,
    outdir: "out",
    target: "chrome109",
    logLevel: "silent",
  });
  const text = (ext: string): string => {
    const file = out.outputFiles.find((f) => f.path.endsWith(ext));
    if (file === undefined) throw new Error(`the bundle has no ${ext}`);
    return file.text;
  };
  return { css: text(".css"), js: text(".js") };
}

/** A demo theme's CSS files as theming serves them: in `@layer canccu-theme`, after the player's. */
export async function themeCss(theme: string, files: string[]): Promise<string> {
  const parts = await Promise.all(
    files.map((f) => readFile(new URL(`${theme}/css/${f}`, THEMES), "utf8")),
  );
  return `@layer canccu-theme{${parts.join("\n")}}`;
}

/** An `@font-face` for a demo theme's font file, by the family name `family`. */
export async function fontFace(theme: string, file: string, family: string): Promise<string> {
  const bytes = await readFile(new URL(`${theme}/fonts/${file}`, THEMES));
  return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${bytes.toString("base64")})}`;
}

/**
 * A page `width`×`height` with the player on it, its server clock at `nowMs`. `extraCss` comes
 * after the player's sheets (a theme, its fonts and tokens).
 */
export async function screenPage(
  browser: Browser,
  code: Bundle,
  [width, height]: [number, number],
  nowMs: number,
  extraCss = "",
): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(
    `<!doctype html><html><head><style>${code.css}</style><style>${extraCss}</style></head>` +
      '<body class="canccu-surface--screen"></body></html>',
  );
  await page.addScriptTag({ content: code.js });
  await page.evaluate((now) => {
    const w = window as unknown as Record<string, unknown>;
    w.canccuNow = now;
    const { Screen } = w.canccuPlayer as { Screen: new (host: unknown) => unknown };
    w.canccuScreen = new Screen({
      serverNow: () => w.canccuNow as number,
      reducedMotion: () => false,
    });
  }, nowMs);
  return page;
}

/** Draws `state` and waits for the fonts and the fits a tick makes. */
export async function draw(page: Page, state: unknown): Promise<void> {
  await page.evaluate(async (s) => {
    const screen = (window as unknown as { canccuScreen: { draw(s: unknown): HTMLElement } })
      .canccuScreen;
    const root = screen.draw(s);
    if (!root.isConnected) document.body.replaceChildren(root);
    await document.fonts.ready;
  }, state);
  await tick(page, 0);
}

/** Moves the server's clock on by `ms` and runs the screen's tick, as its timer would. */
export async function tick(page: Page, ms: number): Promise<void> {
  await page.evaluate((step) => {
    const w = window as unknown as { canccuNow: number; canccuScreen: { tick(): void } };
    w.canccuNow += step;
    w.canccuScreen.tick();
  }, ms);
}
