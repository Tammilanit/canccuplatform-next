/** The motion vocabulary every module shares (contracts/theming.md, Motion vocabulary). */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOTION_STYLE,
  MOTION_LEVELS,
  MOTION_STYLE,
  legacyMotion,
  motionStyleOf,
} from "../src/motion.js";

describe("the motion vocabulary", () => {
  it("lists each style field's choices with its default first", () => {
    expect(MOTION_STYLE).toEqual({
      speed: ["normal", "slower", "faster"],
      intensity: ["normal", "subtle", "strong"],
      spotlight: ["glow_and_trace", "glow", "trace"],
      pack: ["standard", "broadcast", "arcade"],
    });
    expect(DEFAULT_MOTION_STYLE).toEqual({
      speed: "normal",
      intensity: "normal",
      spotlight: "glow_and_trace",
      pack: "standard",
    });
  });

  it("takes each field as given, an unknown or missing one as its default", () => {
    expect(motionStyleOf(undefined)).toEqual(DEFAULT_MOTION_STYLE);
    expect(motionStyleOf({ speed: "faster", pack: "arcade", intensity: "huge" })).toEqual({
      ...DEFAULT_MOTION_STYLE,
      speed: "faster",
      pack: "arcade",
    });
  });

  it("gives older players and the transitions three ways of moving", () => {
    expect(MOTION_LEVELS.map(legacyMotion)).toEqual(["none", "calm", "moderate", "moderate"]);
  });
});
