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

  it("draws the claim on the ticker as one row: no lead, no QR, the status shown again", () => {
    expect(rulesOf(TICKER)).toMatch(/flex-direction:\s*row;/);
    expect(rulesOf(`${TICKER} .canccu-widget__lead`)).toMatch(/display:\s*none;/);
    expect(rulesOf(`${TICKER} .canccu-widget__qr`)).toMatch(/display:\s*none;/);
    expect(rulesOf(`${TICKER} .canccu-widget__meta`)).toMatch(/display:\s*inline;/);
  });
});
