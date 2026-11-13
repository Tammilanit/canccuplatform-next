/// <reference lib="dom" />
/**
 * The safety rules in a real browser (contracts/theming.md, Advanced mode): theme CSS compiled by
 * theming into `@layer canccu-theme` cannot hide, move, cover or restyle the pairing code, the
 * offline marker or the privacy link that ui.css draws in `canccu-base` (packages/ui src/safety.ts).
 * Each attack also hits `.canccu-header`, an ordinary element, where it can: that it does hide the
 * header shows the attack works at all. Each element must stay where it is without a theme, and
 * the screen must show it there, pixel by pixel.
 */
import { readFile } from "node:fs/promises";
import type { BrowserContext, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SAFETY_CLASSES } from "@canccu/ui";
import { compileCss } from "../src/css.js";
import { launch } from "./chromium.js";

const browser = await launch();
const UI_CSS = await readFile(
  new URL("../node_modules/@canccu/ui/ui.css", import.meta.url),
  "utf8",
);

const ALL = [".canccu-header", ...SAFETY_CLASSES.map((c) => `.${c}`)];
const each = (suffix = ""): string => ALL.map((s) => s + suffix).join(", ");

/** [name, the theme's CSS, whether the attack hides the ordinary header]. */
const ATTACKS: [string, string, boolean][] = [
  ["display: none", `${each()} { display: none !important; }`, true],
  ["visibility: hidden", `* { visibility: hidden !important; }`, true],
  ["opacity: 0", `${each()} { opacity: 0 !important; }`, true],
  [
    "transparent text",
    `${each()} { color: transparent !important; -webkit-text-fill-color: transparent !important; }`,
    true,
  ],
  ["font-size: 0", `${each()} { font-size: 0 !important; }`, true],
  [
    "no size",
    `${each()} { width: 0 !important; height: 0 !important; overflow: hidden !important; padding: 0 !important; border: 0 !important; }`,
    true,
  ],
  [
    "moved away",
    `${each()} { position: fixed !important; left: -10000px !important; top: -10000px !important; transform: translateX(-300vw) !important; }`,
    true,
  ],
  ["clipped", `${each()} { clip-path: inset(50%) !important; }`, true],
  ["replaced", `${each()} { content: url(images/blank.png) !important; }`, true],
  [
    "faded by an animation",
    `@keyframes t-fade { to { opacity: 0; transform: translateX(-300vw); } }
     ${each()} { animation: t-fade 1s -1s forwards !important; }`,
    true,
  ],
  [
    "covered by an element",
    `.t-cover { position: fixed; inset: 0; z-index: 2147483647; background: #000000; }`,
    true,
  ],
  [
    "covered by the page's and the root's pseudo-elements",
    `.canccu-page::after, :root::after, :root::before { content: ""; position: fixed; inset: 0; z-index: 2147483647; background: #000000; }`,
    true,
  ],
  [
    "covered by their own pseudo-elements",
    `${each("::after")} { content: "XXXXXXXXXXXXXXXX"; position: absolute; inset: 0; background: #000000; color: #000000; }`,
    true,
  ],
  [
    "their first line and letter",
    `${each("::first-line")}, ${each("::first-letter")} { color: transparent !important; font-size: 0 !important; }`,
    true,
  ],
  ["the page hidden", `:root, .canccu-page { display: none !important; }`, false],
  [
    "the page faded",
    `:root, .canccu-page { opacity: 0 !important; filter: opacity(0) !important; }`,
    false,
  ],
  [
    "the page scaled away",
    `:root, .canccu-page { transform: scale(0) !important; zoom: 0.01 !important; }`,
    false,
  ],
  [
    "the page as their box",
    `.canccu-page { contain: strict !important; container-type: size !important; height: 0 !important; overflow: hidden !important; margin-top: -100vh !important; }`,
    false,
  ],
  ["the page's content skipped", `.canccu-page { content-visibility: hidden !important; }`, false],
  [
    "the page sent along an offset path",
    `:root, .canccu-page { offset-path: path('M 0 0 L 5000 5000'); offset-distance: 100%; offset-position: 5000px 5000px; }`,
    false,
  ],
  [
    "the page blended to black",
    `:root { background: #000000; } .canccu-page { mix-blend-mode: multiply; }`,
    false,
  ],
  [
    "the page blended to white",
    `:root { background: #ffffff; } .canccu-page { mix-blend-mode: screen; }`,
    false,
  ],
  [
    "the page clipped",
    `.canccu-page { position: absolute; clip: rect(0px, 0px, 0px, 0px); }`,
    false,
  ],
  [
    "the page masked by its border image",
    `.canccu-page { -webkit-mask-box-image: linear-gradient(transparent, transparent) 0 fill; mask-border: linear-gradient(transparent, transparent) 0 fill; }`,
    false,
  ],
  [
    "the root as their box in 3D",
    `:root { transform-style: preserve-3d; height: 0; margin-top: -300px; } .canccu-page { transform-style: preserve-3d; height: 0; margin: 0; }`,
    false,
  ],
];

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How an element shows, as a viewer would judge it. */
interface Seen {
  shown: boolean;
  why: string;
  color: string;
  background: string;
  fontSize: number;
}

describe.skipIf(browser === undefined)(
  "the safety elements in Chromium",
  { timeout: 20_000 },
  () => {
    let context: BrowserContext;
    let page: Page;
    /** Where each safety element sits on a page without a theme. */
    const home = new Map<string, Box>();
    beforeAll(async () => {
      if (browser === undefined) return;
      context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      page = await context.newPage();
      await render("");
      for (const name of SAFETY_CLASSES) home.set(name, await box(`.${name}`));
    });
    afterAll(async () => {
      await browser?.close();
    });

    async function render(themeCss: string): Promise<void> {
      const theme = compileCss([{ path: "css/theme.css", bytes: Buffer.from(themeCss) }], (path) =>
        path === "images/blank.png" ? "/theming/a/blank.png" : undefined,
      );
      await page.setContent(
        `<!doctype html><html><head><style>${UI_CSS}</style><style>${theme}</style></head>` +
          '<body class="canccu-page canccu-surface canccu-surface--screen">' +
          '<header class="canccu-header">Header</header><div class="t-cover"></div>' +
          '<main class="canccu-main">Content</main>' +
          '<p class="canccu-pairing-code">K7Q2-9XW4</p>' +
          '<p class="canccu-offline-marker">Offline</p>' +
          '<p class="canccu-preview-mark">Preview</p>' +
          '<a class="canccu-privacy-link" href="/privacy">Privacy</a></body></html>',
      );
    }

    const seen = (selector: string): Promise<Seen> =>
      page.evaluate((sel): Seen => {
        const el = document.querySelector(sel) as HTMLElement;
        const style = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const opaque = (c: string): boolean => !/^rgba\(.*, 0\)$/.test(c) && c !== "transparent";
        const firstLine = getComputedStyle(el, "::first-line");
        const ancestors = [document.documentElement, document.body].map((a) => getComputedStyle(a));
        const checks: [string, boolean][] = [
          ["visible", el.checkVisibility({ opacityProperty: true, visibilityProperty: true })],
          ["in view", r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0],
          ["in view", r.right <= innerWidth && r.bottom <= innerHeight],
          ["on top", hit === el || (hit !== null && el.contains(hit))],
          ["text", el.innerText.trim().length > 0 && parseFloat(style.fontSize) > 0],
          ["text colour", opaque(style.color) && opaque(style.webkitTextFillColor)],
          ["first line", opaque(firstLine.color) && parseFloat(firstLine.fontSize) > 0],
          ["no content", style.content === "normal"],
          ["nothing over it", getComputedStyle(el, "::after").content === "none"],
          ["no animation", style.animationName === "none" && style.opacity === "1"],
          ["ancestors", ancestors.every((a) => a.filter === "none" && a.transform === "none")],
        ];
        const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
        return {
          shown: failed.length === 0,
          why: failed.join(", "),
          color: style.color,
          background: style.backgroundColor,
          fontSize: parseFloat(style.fontSize),
        };
      }, selector);

    const box = (selector: string): Promise<Box> =>
      page.evaluate((sel): Box => {
        const r = (document.querySelector(sel) as Element).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }, selector);

    /**
     * What the screen shows in the element's box: a blend or a mask on an ancestor changes the
     * pixels while the box, the computed style and the hit test stay as they were. The safety
     * elements are white text on black, so both must be there.
     */
    async function painted(at: Box): Promise<{ white: boolean; black: boolean }> {
      const png = await page.screenshot({ clip: at });
      return page.evaluate(async (b64) => {
        const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
        const image = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(image.width, image.height);
        const g = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
        g.drawImage(image, 0, 0);
        const data = g.getImageData(0, 0, image.width, image.height).data;
        let white = 0;
        let black = 0;
        for (let i = 0; i < data.length; i += 4) {
          const [r, gr, b] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
          if (r >= 230 && gr >= 230 && b >= 230) white += 1;
          if (r <= 25 && gr <= 25 && b <= 25) black += 1;
        }
        // The rounded corners show the page; most of the box is the black background.
        return { white: white > 0, black: black > data.length / 4 / 2 };
      }, png.toString("base64"));
    }

    it("shows them on a page without a theme", async () => {
      await render("");
      for (const name of SAFETY_CLASSES) {
        const s = await seen(`.${name}`);
        expect(s, name).toMatchObject({ shown: true, color: "rgb(255, 255, 255)" });
        expect(s.background, name).toBe("rgb(0, 0, 0)");
        expect(s.fontSize, name).toBeGreaterThanOrEqual(16);
      }
      expect((await seen(".canccu-header")).shown).toBe(true);
    });

    it.each(ATTACKS)("a theme cannot hide them: %s", async (_name, css, hidesHeader) => {
      // Proof that the theme's layer applies: it colours the page's content.
      await render(`${css}\n.canccu-main { color: rgb(1, 2, 3); }`);
      expect(
        await page.evaluate(
          () => getComputedStyle(document.querySelector("main") as Element).color,
        ),
      ).toBe("rgb(1, 2, 3)");
      if (hidesHeader) expect((await seen(".canccu-header")).shown).toBe(false);
      for (const name of SAFETY_CLASSES) {
        const s = await seen(`.${name}`);
        expect({ name, why: s.why }).toEqual({ name, why: "" });
        expect(s).toMatchObject({ color: "rgb(255, 255, 255)", background: "rgb(0, 0, 0)" });
        expect(s.fontSize).toBeGreaterThanOrEqual(16);
        const at = home.get(name) as Box;
        expect({ name, box: await box(`.${name}`) }).toEqual({ name, box: at });
        expect({ name, painted: await painted(at) }).toEqual({
          name,
          painted: { white: true, black: true },
        });
      }
    });
  },
);
