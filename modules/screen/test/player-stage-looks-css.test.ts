/** The living stage's CSS against the motion rules (#787 D10, D11; contracts/theming.md, Motion vocabulary). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(new URL(`../player/src/${f}`, import.meta.url), "utf8");

describe("stage-looks.css", () => {
  const css = read("stage-looks.css");

  it("animates only opacity and transform", () => {
    const frames = [...css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n {2}\}/g)].map((m) => m[1]);
    expect(frames).toHaveLength(2);
    for (const body of frames) {
      const props = [...(body ?? "").matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1]);
      for (const p of props) expect(["opacity", "transform"]).toContain(p);
    }
  });

  it("moves nothing at none, and draws no particles there", () => {
    expect(css).not.toMatch(/canccu-motion--none[^{]*\{[^}]*animation/);
    expect(css).toMatch(/body\.canccu-motion--none \.canccu-stage__particles \{\s*display: none;/);
    for (const m of css.matchAll(/animation: ([^;]*);/g)) {
      const s = Number(/(\d+)s/.exec(m[1] ?? "")?.[1]);
      expect(s, m[1]).toBeGreaterThanOrEqual(10);
    }
  });

  it("fades from one look to the next over 40 s at every level", () => {
    expect(css).toMatch(
      /\.canccu-stage__look > \* \{\s*opacity: 0;[\s\S]*?transition: opacity var\(--canccu-look-fade, 40s\)/,
    );
  });
});

describe("change-glow.css", () => {
  it("moves nothing but the fade change-glow.ts drives", () => {
    const css = read("change-glow.css");
    expect(css).not.toMatch(/animation|transition|@keyframes/);
    expect(css).toMatch(/--canccu-changed/);
  });
});

describe("stage.css", () => {
  it("leaves the time of day to the stage's own layer", () => {
    expect(read("stage.css")).not.toMatch(/data-canccu-daypart/);
  });
});
