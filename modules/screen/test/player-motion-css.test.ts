/** The player's motion.css against the motion vocabulary's rules (contracts/theming.md, Motion vocabulary). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("motion.css", () => {
  const css = readFileSync(new URL("../player/src/motion.css", import.meta.url), "utf8");

  it("repeats nothing faster than once every 1.6 s at normal speed (the 3-per-second rule)", () => {
    const repeating = [...css.matchAll(/animation:\s*([^;]*infinite[^;]*);/g)].map((m) => m[1]);
    expect(repeating.length).toBeGreaterThan(0);
    for (const rule of repeating) {
      const ms = /calc\((\d+)ms/.exec(rule ?? "")?.[1] ?? /(\d+)s\b/.exec(rule ?? "")?.[1];
      const base = rule?.includes("ms") ? Number(ms) : Number(ms) * 1000;
      // At `faster` (0.75) the glow pulse still takes 1.2 s.
      expect(base * 0.75, rule).toBeGreaterThanOrEqual(1200);
    }
  });

  it("animates only opacity and transform", () => {
    const frames = [...css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n {2}\}/g)].map((m) => m[1]);
    expect(frames.length).toBeGreaterThan(8);
    for (const body of frames) {
      const props = [...(body ?? "").matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1]);
      for (const p of props) expect(["opacity", "transform"]).toContain(p);
    }
  });
});
