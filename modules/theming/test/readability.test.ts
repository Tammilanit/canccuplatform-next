/**
 * The small-text warning (contracts/theming.md, Advanced mode, Small text; plan D11): each
 * font-size that can apply on the screen surface, resolved for a 1920×1080 screen, under 27 px.
 */
import { describe, expect, it } from "vitest";
import { checkCss } from "../src/css.js";
import type { FontSize } from "../src/readability.js";
import { textSmallProblems } from "../src/readability.js";

function sizes(css: string): FontSize[] {
  const checked = checkCss("css/theme.css", Buffer.from(css));
  if (!checked.ok) throw new Error(checked.problem.message);
  return checked.sizes;
}

/** The selectors warned about, for one file or several in theme.yaml's order. */
function small(...files: string[]): string[] {
  return textSmallProblems(
    files.map((css, i) => ({ path: `css/${String(i)}.css`, sizes: sizes(css) })),
  ).map((p) => {
    expect(p).toMatchObject({ severity: "warning", code: "text_small" });
    return p.message;
  });
}

describe("text_small", () => {
  it.each([
    ["px", ".t-a { font-size: 20px; }", true],
    ["px at the line", ".t-a { font-size: 27px; }", false],
    ["rem against the platform's 16 px", ".t-a { font-size: 1.5rem; }", true],
    ["rem at 27 px", ".t-a { font-size: 1.6875rem; }", false],
    ["em against the platform's 16 px", ".t-a { font-size: 1.5em; }", true],
    ["% against the platform's 16 px", ".t-a { font-size: 150%; }", true],
    ["vh against 1080", ".t-a { font-size: 2vh; }", true],
    ["vh at 2.5", ".t-a { font-size: 2.5vh; }", false],
    ["vmin against 1080", ".t-a { font-size: 2vmin; }", true],
    ["vw against 1920", ".t-a { font-size: 1.5vw; }", false],
    ["vmax against 1920", ".t-a { font-size: 1vmax; }", true],
    ["pt", ".t-a { font-size: 18pt; }", true],
    ["an absolute keyword", ".t-a { font-size: small; }", true],
    ["calc()", ".t-a { font-size: calc(1rem + 4px); }", true],
    ["calc() that reaches the line", ".t-a { font-size: calc(1rem + 12px); }", false],
    ["clamp() at its minimum", ".t-a { font-size: clamp(1rem, 5vh, 4rem); }", true],
    ["min()", ".t-a { font-size: min(2rem, 2vh); }", true],
    ["max()", ".t-a { font-size: max(1rem, 3vh); }", false],
    ["the font shorthand", ".t-a { font: italic 700 1rem/1.2 sans-serif; }", true],
    ["the font shorthand, large", ".t-a { font: 700 2rem/1.2 sans-serif; }", false],
    ["var(), which it cannot resolve", ".t-a { font-size: var(--t-size); }", false],
    ["a unit it cannot resolve", ".t-a { font-size: 3cqh; }", false],
  ])("%s", (_name, css, warns) => {
    expect(small(css)).toHaveLength(warns ? 1 : 0);
  });

  it("names the file and the selector", () => {
    const [p] = textSmallProblems([
      { path: "css/cards.css", sizes: sizes(".t-a, .t-b span { font-size: 12px; }") },
    ]);
    expect(p).toMatchObject({ path: "css/cards.css", code: "text_small", severity: "warning" });
    expect(p?.message).toContain(".t-a, .t-b span");
    expect(p?.message).toContain("12px");
  });

  it("skips selectors only another surface matches", () => {
    expect(small(".canccu-surface--hub .t-a { font-size: 12px; }")).toEqual([]);
    expect(small(".canccu-surface--admin.canccu-page { font-size: 12px; }")).toEqual([]);
    const [message] = small(".canccu-surface--hub .t-a, .t-b { font-size: 12px; }");
    expect(message).toContain(".t-b");
    expect(message).not.toContain("hub");
    expect(small(".canccu-surface--screen .t-a { font-size: 12px; }")).toHaveLength(1);
  });

  it("follows nesting and conditional rules, but not keyframes", () => {
    expect(small(".canccu-surface--info { & .t-a { font-size: 12px; } }")).toEqual([]);
    expect(small(".t-b { & .t-a { font-size: 12px; } }")).toHaveLength(1);
    expect(small("@media (min-width: 1px) { .t-a { font-size: 12px; } }")).toHaveLength(1);
    expect(small("@keyframes t-grow { from { font-size: 1px; } to { font-size: 40px; } }")).toEqual(
      [],
    );
  });

  it("resolves rem against the root size the theme sets, in any of its files, last one winning", () => {
    expect(small(":root { font-size: 24px; } .t-a { font-size: 1.25rem; }")).toEqual([]);
    expect(small("html { font-size: 150%; }", ".t-a { font-size: 1.25rem; }")).toEqual([]);
    expect(
      small(
        ":root { font-size: 24px; }",
        ":root { font-size: 16px; } .t-a { font-size: 1.25rem; }",
      ),
    ).toHaveLength(1);
    // The root size is a scale, text of its own only when it shrinks the platform's.
    expect(small(":root { font-size: 10px; }")).toHaveLength(1);
    expect(small(":root { font-size: 16px; }")).toEqual([]);
  });

  it("caps the warnings of one file", () => {
    const css = Array.from({ length: 30 }, (_, i) => `.t-${String(i)} { font-size: 8px; }`).join(
      "",
    );
    const messages = small(css);
    expect(messages).toHaveLength(10);
    expect(messages[9]).toContain("20 more");
  });
});
