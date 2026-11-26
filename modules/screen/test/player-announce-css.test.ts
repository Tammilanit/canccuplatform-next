/**
 * The announcement's look and motion as stylesheets (contracts/screen.md, Announcements by level,
 * #780): readable across a hall in every role, on one left edge, and moving only where the motion
 * level lets it. The CI shots measure the drawn sizes (scripts/demo-screenshots-announce-levels.mjs).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(new URL(`../player/src/${file}`, import.meta.url), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
const look = read("announce.css");
const motion = read("announce-motion.css");
const rulesOf = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? "").replace(/\s+/g, " ").trim(),
    body: m[2] ?? "",
  }));

describe("the announcement's look", () => {
  it("measures in 1 % of the screen's height, in landscape and in portrait", () => {
    expect(look).toMatch(/\.canccu-widget--announcement \{\s*--canccu-ann-u: 1vh;/);
  });

  it("never draws a card's title under 6 % of the screen's height, nor its body under 3.5 %", () => {
    const sized = rulesOf(look).filter(
      (r) => /__(title|body)$/.test(r.selector) && r.body.includes("font-size:"),
    );
    expect(sized.length).toBeGreaterThanOrEqual(4);
    for (const { selector, body } of sized) {
      expect(selector).not.toContain('data-role="ticker"');
      const size = (/font-size: ([^;]+);/.exec(body)?.[1] ?? "")
        .replace(/\s+/g, " ")
        .replace(/\( /g, "(")
        .replace(/ \)/g, ")");
      const floor = selector.endsWith("__title") ? 6 : 3.5;
      const m = /^max\(([\d.]+) \* var\(--canccu-ann-u\), calc\(([\d.]+) \* var\(--canccu-ann-u\) \* var\(--canccu-fit, 1\)\)\)$/.exec(size);
      expect(m, selector).not.toBeNull();
      expect(Number(m?.[1]), selector).toBe(floor);
      expect(Number(m?.[2]), selector).toBeGreaterThanOrEqual(floor);
    }
  }); // prettier-ignore

  it("puts label, title and body on one left edge in the rail, the hero and the full screen", () => {
    const edge = rulesOf(look).find((r) => r.selector.includes("text-align") || r.body.includes("text-align: start"));
    for (const role of ['.canccu-region:not([data-role="ticker"]) > .canccu-widget--announcement', '.canccu-region[data-role="hero"] > .canccu-widget--announcement.canccu-is-claim', ".canccu-region--_full > .canccu-widget--announcement.canccu-is-claim"]) {
      expect(edge?.selector, role).toContain(role);
    }
    const block = rulesOf(look).find((r) => r.selector.endsWith("> .canccu-widget__level"));
    expect(block?.body).toContain("align-items: flex-start;");
  }); // prettier-ignore

  it("frames the card in its level's colour, and draws an alarm's instruction band along the bottom", () => {
    expect(look).toMatch(/:has\(\.canccu-widget__level--important\) \{\s*--canccu-ann-ink: var\(--canccu-color-accent\);/);
    expect(look).toMatch(/:has\(\.canccu-widget__level--urgent\) \{\s*--canccu-ann-ink: var\(--canccu-color-status-degraded\);/);
    const band = rulesOf(look).find((r) => r.selector === ".canccu-region--_full > .canccu-widget--announcement .canccu-widget__instruction");
    // In the card's flow, edge to edge and uncapped, under a block centred in the room it leaves.
    expect(band?.body).toContain("position: relative;");
    expect(band?.body).toContain("padding: calc(2.2 * var(--canccu-ann-u)) 0;");
    expect(band?.body).toContain("border-image: linear-gradient(var(--canccu-ann-band) 0 0) fill 0 / 0 / 0 100vw 100vw;");
    expect(band?.body).not.toMatch(/line-clamp|overflow:|white-space/);
    const card = rulesOf(look).find((r) => r.selector.endsWith(":has(> .canccu-widget__instruction)"));
    expect(card?.body).toContain("padding-bottom: 0;");
    const block = rulesOf(look).find((r) => r.selector.includes(":has(> .canccu-widget__instruction)") && r.selector.endsWith("> .canccu-widget__level"));
    expect(block?.body).toContain("margin-block: auto;");
  }); // prettier-ignore

  it("gives the body its font's own line height, so a theme's taller font pair stays in the box", () => {
    const body = rulesOf(look).find((r) => r.selector === '.canccu-region:not([data-role="ticker"]) > .canccu-widget--announcement .canccu-widget__body');
    expect(body?.body).toContain("line-height: normal;");
  }); // prettier-ignore
});

describe("the announcement's motion", () => {
  it("moves only opacity and transform", () => {
    const frames = [...motion.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n\}/g)].map((m) => m[1] ?? "");
    expect(frames.length).toBeGreaterThan(5);
    for (const frame of frames) {
      for (const [, prop] of frame.matchAll(/([\w-]+):/g)) expect(["opacity", "transform"]).toContain(prop);
    }
  }); // prettier-ignore

  it("starts every picture only at a motion level that moves, or on a card the clock keeps alive", () => {
    for (const { selector, body } of rulesOf(motion)) {
      if (!/(^|;)\s*animation(-name)?:/.test(body)) continue;
      // `.canccu-ann--alive` is set only off `none` (announce-motion.ts); the particles hide there.
      const gated = /canccu-motion--(lively|party|calm)|canccu-ann--alive|canccu-widget__ambient > i/.test(selector);
      expect(gated, selector).toBe(true);
      expect(selector, selector).not.toContain("canccu-motion--none");
    }
  }); // prettier-ignore

  it("counts the endless pictures from the claim's start, so a zone's screens agree", () => {
    for (const sel of [
      ".canccu-ann--alive > .canccu-widget__ambient::before",
      ".canccu-ann--alive::after",
    ]) {
      const rule = rulesOf(motion).find((r) => r.selector === sel);
      expect(rule?.body, sel).toContain("var(--canccu-ann-delay)");
    }
    expect(motion).toMatch(/--canccu-ann-delay: calc\(-1 \* var\(--canccu-ann-since, 0s\)\);/);
  });
});
