/// <reference lib="dom" />
/**
 * The safety rules in a real browser (contracts/theming.md, Advanced mode): theme CSS compiled by
 * theming into `@layer canccu-theme` cannot hide, move, cover or restyle the pairing code, the
 * offline marker or the privacy link that ui.css draws in `canccu-base` (packages/ui src/safety.ts).
 * Each attack also hits `.canccu-header`, an ordinary element, where it can: that it does hide the
 * header shows the attack works at all.
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
];

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
    beforeAll(async () => {
      if (browser === undefined) return;
      context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      page = await context.newPage();
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
      }
    });
  },
);
