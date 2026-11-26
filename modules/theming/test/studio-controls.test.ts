/**
 * The Advanced page's controls come from one table (plan issue-784 D14): every token has exactly
 * one control in words, with a tooltip, and the motion level, speed and strength have none (D22).
 */
import { describe, expect, it } from "vitest";
import { COLOR_TOKENS, FONT_TOKENS, MOTION_STYLE, SIZE_TOKENS } from "@canccu/ui";
import { ADVANCED_CONTROLS } from "../src/studio-controls.js";

const tokensOf = (group: string, names: object): string[] =>
  Object.keys(names).map((name) => `${group}.${name}`);

describe("ADVANCED_CONTROLS", () => {
  const controlled = ADVANCED_CONTROLS.map((c) => c.token);

  it("gives every token and motion style exactly one control", () => {
    const wanted = [
      ...tokensOf("colors", COLOR_TOKENS),
      ...tokensOf("fonts", FONT_TOKENS),
      ...tokensOf("sizes", SIZE_TOKENS),
      // The motion level, speed and strength are no theme control (D22): the zone sets the level
      // in Screen settings, and the hype curve and the level cover speed and strength.
      ...tokensOf("motion_style", MOTION_STYLE).filter(
        (t) => t !== "motion_style.speed" && t !== "motion_style.intensity",
      ),
    ];
    expect([...controlled].sort()).toEqual([...wanted].sort());
    expect(new Set(controlled).size).toBe(controlled.length);
    for (const none of ["motion", "motion_style.speed", "motion_style.intensity"]) {
      expect(controlled).not.toContain(none);
    }
  });

  it("explains every control in words, never by its token key", () => {
    for (const c of ADVANCED_CONTROLS) {
      expect(c.hint.trim(), c.token).not.toBe("");
      expect(c.what.trim(), c.token).not.toBe("");
      const key = c.token.split(".")[1] ?? "";
      expect(c.label, c.token).not.toMatch(/^[a-z0-9_.]+$/);
      expect(c.label, c.token).not.toContain("_");
      expect(c.label, c.token).not.toBe(key);
      expect(c.label, c.token).not.toContain("--canccu");
      expect(c.cssVar, c.token).toMatch(/^--canccu-[a-z0-9-]+$/);
    }
  });

  it("draws sizes as sliders with the plan's ranges, in groups by what they affect", () => {
    const by = (token: string) => ADVANCED_CONTROLS.find((c) => c.token === token);
    expect(by("sizes.radius")).toMatchObject({
      group: "shapes",
      control: "slider",
      range: [0, 24],
    });
    expect(by("sizes.border_width")).toMatchObject({ group: "shapes", range: [0, 4] });
    expect(by("sizes.gap")).toMatchObject({ group: "shapes", range: [8, 32] });
    expect(by("sizes.safe_inset")).toMatchObject({ group: "screen", range: [24, 96] });
    expect(by("colors.background")).toMatchObject({ group: "colours", control: "colour" });
    expect(by("fonts.heading")).toMatchObject({ group: "type", control: "font" });
    expect(by("motion_style.pack")).toMatchObject({ group: "motion", control: "chips" });
    for (const c of ADVANCED_CONTROLS.filter((x) => x.control === "slider")) {
      expect(c.step, c.token).toBeGreaterThan(0);
    }
    for (const c of ADVANCED_CONTROLS.filter((x) => x.control === "chips")) {
      expect(c.options?.length, c.token).toBeGreaterThan(1);
    }
  });
});
