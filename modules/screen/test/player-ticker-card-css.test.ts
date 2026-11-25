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
    expect(title).toMatch(/overflow:\s*clip;/);
  });
});

/**
 * The ticker band's idle logo (#771): the out-of-header card's 5.5u name over a large mark is
 * taller than the one-row band, which cut "DEMO EVENT" in half at 1920×1080. In the ticker the logo
 * is one row at the header's size, as in the header.
 */
describe("widgets.css, a logo in the ticker band", () => {
  const widgets = readFileSync(new URL("../player/src/widgets.css", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ");
  const LOGO = "> .canccu-widget--logo";

  it("never takes the out-of-header card's large mark and name", () => {
    const card = [
      ...widgets.matchAll(
        /([^{}]*\.canccu-region:not\(([^)]*)\) > \.canccu-widget--logo[^{}]*)\{/g,
      ),
    ];
    expect(card.length).toBeGreaterThan(0);
    for (const m of card) expect(m[2], m[1]).toContain('[data-role="ticker"]');
  });

  it("is one row, as the header's logo", () => {
    const row = [...widgets.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
      (m) => (m[1] ?? "").includes('[data-role="ticker"]') && (m[1] ?? "").trim().endsWith(LOGO),
    );
    expect(row?.[1]).toContain('[data-role="header"]');
    expect(row?.[2]).toMatch(/flex-direction: row;/);
  });
});

describe("claims.css, a takeover that keeps the ticker running (#780)", () => {
  it("shows the ticker regions again under it, after the rule that hides every region", () => {
    const keep = '.canccu-layout[data-takeover="ticker"] > .canccu-region[data-role="ticker"]';
    expect(rulesOf(keep)).toMatch(/visibility:\s*visible;/);
    expect(rules.indexOf(keep)).toBeGreaterThan(rules.indexOf(".canccu-layout[data-takeover]"));
  });
});
