/**
 * The food box's look (player/src/food.css; #643, #771): its lead says what the first order's
 * status says, so that status steps aside; Moments' pizza claim on the ticker is one line in the
 * box's words, never the lead's large time in a one-row band; the sheet loads with the player.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(new URL(`../player/src/${file}`, import.meta.url), "utf8");
const rules = read("food.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule body whose selector list holds `selector` exactly. */
function rulesOf(selector: string): string {
  const out: string[] = [];
  for (const m of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? "").split(",").map((s) => s.replace(/\s+/g, " ").trim());
    if (selectors.includes(selector)) out.push(m[2] ?? "");
  }
  return out.join("\n");
}

const BOX = ".canccu-widget--food_status";
const TICKER = `.canccu-region[data-role="ticker"] > ${BOX}`;

describe("food.css", () => {
  it("loads with the player", () => {
    expect(read("main.ts")).toContain('import "./food.css";');
  });

  it("hides the first row's status after a lead, never another row's", () => {
    const after = rulesOf(`${BOX} .canccu-widget__lead + .canccu-widget__row .canccu-widget__meta`);
    expect(after).toMatch(/display:\s*none;/);
    expect(rulesOf(`${BOX} .canccu-widget__meta`)).toBe("");
  });

  it("marks the box with a pizza in the theme's colours", () => {
    const mark = rulesOf(`${BOX} .canccu-widget__kicker::before`);
    expect(mark).toMatch(/background:\s*var\(--canccu-color-[a-z-]+\);/);
    expect(mark).toMatch(/mask:\s*url\("data:image\/svg\+xml,/);
  });

  // #775: "collect at Entrance table" and a long pizzeria name ran into the QR's half.
  it("wraps a long word inside the box, wherever it stands but the ticker's one line", () => {
    expect(rulesOf(`.canccu-region:not([data-role="ticker"]) > ${BOX}`)).toMatch(
      /overflow-wrap:\s*anywhere;/,
    );
    // A long pizzeria name wraps too, never cut with an ellipsis: the fit makes room for it.
    expect(rulesOf(`${BOX} .canccu-widget__name`)).not.toMatch(/white-space|text-overflow/);
  });

  it("steps its type down with the fit (fit.ts), never under 27 px at 1080p (2.8 units)", () => {
    const stepped = (base: number, floor = 2.8) =>
      new RegExp(
        `font-size:\\s*max\\(${floor} \\* var\\(--canccu-u\\), calc\\(${base} \\* var\\(--canccu-u\\) \\* var\\(--canccu-fit, 1\\)\\)\\);`,
      );
    expect(rulesOf(`${BOX} .canccu-widget__kicker`)).toMatch(stepped(3.4));
    expect(rulesOf(`${BOX} .canccu-widget__label`)).toMatch(stepped(3.4));
    expect(rulesOf(`${BOX} .canccu-widget__big`)).toMatch(stepped(7.4, 4.4));
    expect(rulesOf(`${BOX} .canccu-widget__name`)).toMatch(stepped(4.4));
    expect(rulesOf(`${BOX} .canccu-widget__row .canccu-widget__meta`)).toMatch(stepped(3.4));
    expect(read("fit.ts")).toContain('`.canccu-region:not([data-role="ticker"]) > ${FOOD}`');
  });

  it("shows two orders at most in the venue rail, so a long status never pushes one half out", () => {
    const third = `.canccu-region[data-role="venue_rail"] > ${BOX} .canccu-widget__row ~ .canccu-widget__row ~ .canccu-widget__row`;
    expect(rulesOf(third)).toMatch(/display:\s*none;/);
  });

  // #775: the cue's frame sat on the region, 4 units inside the claimed box that reached into the
  // QR's half. #779: the two parts are cards of their own, so the box is its region, and the frame
  // on the region is the box's.
  it("draws the venue rail's parts as cards of their own, the box its region: one frame", () => {
    const rail = read("rail.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rail).not.toMatch(/\.canccu-region--venue_rail(-2)? > \.canccu-widget|\.canccu-cue/);
    // The seam moves the regions themselves, the gap between them kept.
    expect(rail).toMatch(
      /\.canccu-region--venue_rail \{\s*margin-right: calc\(-1 \* var\(--canccu-venue-seam\)\);\s*\}/,
    );
    expect(rail).toMatch(
      /\.canccu-region--venue_rail-2 \{\s*margin-left: var\(--canccu-venue-seam\);\s*\}/,
    );
  });

  it("draws the claim on the ticker as one row: no lead, no QR, the status shown again", () => {
    expect(rulesOf(TICKER)).toMatch(/flex-direction:\s*row;/);
    expect(rulesOf(`${TICKER} .canccu-widget__lead`)).toMatch(/display:\s*none;/);
    expect(rulesOf(`${TICKER} .canccu-widget__qr`)).toMatch(/display:\s*none;/);
    expect(rulesOf(`${TICKER} .canccu-widget__meta`)).toMatch(/display:\s*inline;/);
  });

  // #775 review: the box's wrap and fit are not the ticker's; its one line ends a long name with an
  // ellipsis, and its label is the ticker's own size.
  it("keeps the claim on the ticker one line: a long name ends with an ellipsis", () => {
    const name = rulesOf(`${TICKER} .canccu-widget__name`);
    expect(name).toMatch(/overflow:\s*clip;/);
    expect(name).toMatch(/text-overflow:\s*ellipsis;/);
    expect(name).toMatch(/white-space:\s*nowrap;/);
    expect(rulesOf(`${TICKER} .canccu-widget__kicker`)).toMatch(
      /font-size:\s*calc\(3\.4 \* var\(--canccu-u\)\);/,
    );
  });
});
