/**
 * The hero rule (#625; docs/briefs/step-4-polish/README.md, The hero uses the screen; sheets
 * 07–10) in the player's hero.css: one centred block, the sheet's type scale in the screen's
 * unit, a photo that fills the hero under a scrim, stings and loud steps bright on the theme's
 * gradient, Premiere's film edge to edge, and Urgent in the warning colour.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(new URL(`../player/src/${file}`, import.meta.url), "utf8");
const hero = read("hero.css");
const rules = hero.replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first rule whose selector list holds `selector` exactly. */
function ruleOf(selector: string): string {
  for (const m of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? "").split(",").map((s) => s.replace(/\s+/g, " ").trim());
    if (selectors.includes(selector)) return m[2] ?? "";
  }
  throw new Error(`no rule for ${selector}`);
}

/** The sheet's px at 1080p in the screen's unit: 1 % of the layout's short side, 10.8 px. */
const unit = (px: number) => Math.round((px / 10.8) * 10) / 10;

const STEP_IN_HERO = '.canccu-region[data-role="hero"] > .canccu-widget.canccu-is-claim';

describe("hero.css, the hero rule", () => {
  it("sizes all its text in the screen's unit, at least the 2.6 readability floor", () => {
    // As test/player-readable.test.ts holds the other sheets; hero.css is not among them, since
    // it reads the hero's size in a container query (`cqmin`), as stage.css does.
    const sizes = [...rules.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]?.trim() ?? "");
    expect(sizes.length).toBeGreaterThan(10);
    for (const size of sizes) {
      const stepped =
        /^max\(([\d.]+) \* var\(--canccu-u\), calc\(([\d.]+) \* var\(--canccu-u\) \* var\(--canccu-fit, 1\)\)\)$/.exec(
          size,
        );
      const plain = /^calc\(([\d.]+) \* var\(--canccu-u\)\)$/.exec(size);
      expect(stepped ?? plain, size).not.toBeNull();
      expect(Number((stepped ?? plain)?.[1]), size).toBeGreaterThanOrEqual(2.6);
    }
    expect(rules).not.toContain("!important");
  });

  it("is loaded by the player, in the base layer, after the claims' look", () => {
    const main = read("main.ts");
    expect(main.indexOf('import "./hero.css"')).toBeGreaterThan(
      main.indexOf('import "./claims.css"'),
    );
    expect(hero).toMatch(/@layer canccu-base \{[\s\S]*\}\s*$/);
  });

  it("centres one block across and down in the hero less 64 px, never pinned to a corner", () => {
    const body = ruleOf(STEP_IN_HERO);
    expect(body).toContain("align-items: center;");
    expect(body).toContain("justify-content: center;");
    expect(body).toContain("text-align: center;");
    expect(body).toContain(`padding: calc(${String(unit(64))} * var(--canccu-u));`);
  });

  it("sets the sheet's scale: kicker 44, headline 160 down to 88, body 60, countdown 330, sting 230", () => {
    const size = (selector: string) => /font-size: ([^;]+);/.exec(ruleOf(selector))?.[1];
    const fit = (floor: number, full: number) =>
      `max(${String(unit(floor))} * var(--canccu-u), calc(${String(unit(full))} * var(--canccu-u) * var(--canccu-fit, 1)))`;
    expect(size(`${STEP_IN_HERO} .canccu-widget__kicker`)).toBe(
      `calc(${String(unit(44))} * var(--canccu-u))`,
    );
    expect(size(`${STEP_IN_HERO} .canccu-widget__title`)).toBe(fit(88, 160));
    expect(size(`${STEP_IN_HERO} .canccu-widget__body`)).toBe(fit(44, 60));
    expect(size(`${STEP_IN_HERO} .canccu-widget__count .canccu-widget__big`)).toBe(fit(88, 330));
    expect(size(`${STEP_IN_HERO}.canccu-widget--sting .canccu-widget__big`)).toBe(fit(88, 230));
    // Full screen (Midnight, Premiere's countdown): the countdown 420 px, the sting 300 px.
    expect(
      size(
        ".canccu-region--_full > .canccu-widget.canccu-is-claim .canccu-widget__count .canccu-widget__big",
      ),
    ).toBe(fit(88, 420));
    expect(size(".canccu-region--_full > .canccu-widget--sting .canccu-widget__big")).toBe(
      fit(88, 300),
    );
  });

  it("draws stings and a step that enters with a flash bright on the theme's gradient, in its dark ink", () => {
    for (const selector of [
      ".canccu-region > .canccu-widget--sting.canccu-is-claim",
      ".canccu-region > .canccu-widget.canccu-is-claim.canccu-step--flash",
    ]) {
      const body = ruleOf(selector);
      // Under a light sweep, the last background layer.
      expect(body, selector).toMatch(
        /background:[^;]*,\s*linear-gradient\(\s*\d+deg,\s*var\(--canccu-color-primary\),\s*var\(--canccu-color-accent\)\s*\);/,
      );
      expect(body, selector).toContain("color: var(--canccu-color-primary-text);");
    }
  });

  it("lets a crew photo fill the hero, cropped from the centre, with its words on a scrim at its foot", () => {
    const PHOTO = '.canccu-region[data-role="hero"] > .canccu-widget--photo.canccu-is-claim';
    const image = ruleOf(`${PHOTO} .canccu-widget__image`);
    expect(image).toContain("object-fit: cover;");
    expect(image).toContain("object-position: center;");
    const scrim = ruleOf(`${PHOTO}::after`);
    expect(scrim).toMatch(/linear-gradient\(\s*180deg,\s*transparent[^;]*\b94%/);
  });

  it("plays Premiere's film edge to edge: no card, no border, no padding", () => {
    const body = ruleOf(".canccu-region--_full > .canccu-widget--video");
    expect(body).toContain("inset: calc(-1 * var(--canccu-safe-inset));");
    expect(body).toContain("padding: 0;");
    expect(body).toContain("border: 0;");
    expect(body).toContain("border-radius: 0;");
    expect(body).toContain("box-shadow: none;");
  });

  it("says Urgent in the warning colour, on the kicker and the frame", () => {
    expect(ruleOf(".canccu-widget__level--urgent .canccu-widget__urgent")).toContain(
      "color: var(--canccu-color-status-degraded);",
    );
    expect(
      ruleOf(".canccu-region > .canccu-widget.canccu-is-claim:has(.canccu-widget__level--urgent)"),
    ).toContain("border-color: var(--canccu-color-status-degraded);");
  });

  // #638 (V5): the cue's frame and glow kept the primary colour over an urgent card.
  it("gives an urgent card's cue frame and glow the warning colour too", () => {
    // On the region, which carries `.canccu-cue` (applyCue(drawn.el)); a child's property never
    // reaches the region's ::after.
    expect(
      ruleOf(".canccu-region:has(> .canccu-widget.canccu-is-claim .canccu-widget__level--urgent)"),
    ).toContain("--canccu-cue-ink: var(--canccu-color-status-degraded);");
    expect(
      ruleOf(".canccu-region > .canccu-widget.canccu-is-claim:has(.canccu-widget__level--urgent)"),
    ).not.toContain("--canccu-cue-ink");
    const cues = read("cues.css").replace(/\/\*[\s\S]*?\*\//g, "");
    // The primary only as the ink's fallback, never on its own.
    expect(cues.replaceAll("var(--canccu-cue-ink, var(--canccu-color-primary))", "")).not.toContain(
      "--canccu-color-primary",
    );
    expect(cues.match(/var\(--canccu-cue-ink, var\(--canccu-color-primary\)\)/g)?.length).toBe(3);
  });

  // #638 (V5): the ticker's URGENT label sat on the accent ground.
  it("gives an urgent ticker line's label the warning colour", () => {
    const claims = read("claims.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /([^{}]*:has\(\.canccu-widget__urgent\)[^{}]*)\{([^{}]*)\}/.exec(claims);
    expect(rule?.[1]).toContain(".canccu-widget__label");
    expect(rule?.[2]).toContain("background: var(--canccu-color-status-degraded);");
  });

  // #775: Pizza is here's art, a pizza over the title, at one size whatever the image's own.
  it("draws a card's art in the hero at a share of it, stepping down with the fit", () => {
    const art = ruleOf(
      '.canccu-region[data-role="hero"] > .canccu-widget--title_card.canccu-is-claim .canccu-widget__image',
    );
    expect(art).toMatch(
      /height:\s*max\(8\.1 \* var\(--canccu-u\), calc\(22 \* var\(--canccu-u\) \* var\(--canccu-fit, 1\)\)\);/,
    );
    expect(art).toMatch(/flex:\s*none;/);
  });
});
