/**
 * An announcement card that holds the ticker role (a zone whose rail is hidden; L4) in the
 * player's claims.css: one line along the ticker, its title and then its ticker line, never its
 * kicker, title, body and line stacked and clipped in the ticker's height (#668, A8). The card's
 * level box is a block by default, so the row it is given must make it a flex box first.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const claims = readFileSync(new URL("../player/src/claims.css", import.meta.url), "utf8");
const rules = claims.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule body whose selector list holds `selector` exactly. */
function rulesOf(selector: string): string {
  const out: string[] = [];
  for (const m of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? "").split(",").map((s) => s.replace(/\s+/g, " ").trim());
    if (selectors.includes(selector)) out.push(m[2] ?? "");
  }
  return out.join("\n");
}

const CARD = '.canccu-region[data-role="ticker"] > .canccu-widget--announcement';

describe("claims.css, a card in the ticker role", () => {
  it("lays its parts out in one row: the level box is a flex row, not a block", () => {
    const level = rulesOf(`${CARD} > .canccu-widget__level`);
    expect(level).toMatch(/display:\s*flex;/);
    expect(level).toMatch(/flex-direction:\s*row;/);
    expect(level).toMatch(/flex-wrap:\s*nowrap;/);
  });

  it("falls back to its title: the body stays off the ticker", () => {
    expect(rulesOf(`${CARD} .canccu-widget__body`)).toMatch(/display:\s*none;/);
  });

  it("keeps its title on one line and cuts a long one with an ellipsis", () => {
    const title = rulesOf(`${CARD} .canccu-widget__title`);
    expect(title).toMatch(/white-space:\s*nowrap;/);
    expect(title).toMatch(/text-overflow:\s*ellipsis;/);
    expect(title).toMatch(/overflow:\s*hidden;/);
  });
});
