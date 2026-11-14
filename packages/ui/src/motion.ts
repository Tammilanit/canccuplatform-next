/**
 * The motion vocabulary every module shares (contracts/theming.md, Motion vocabulary;
 * contracts/screen.md, Motion and burn-in drift): theming's token CSS and Studio form, Screen's
 * composed state and the player all read these, so a new value cannot reach one and fall back to
 * its default in another.
 */

/** The `motion_style` token's fields. */
export interface MotionStyle {
  speed: "normal" | "slower" | "faster";
  intensity: "normal" | "subtle" | "strong";
  spotlight: "glow_and_trace" | "glow" | "trace";
  pack: "standard" | "broadcast" | "arcade";
}

/** Each field's choices, default first (Studio lists them so). */
export const MOTION_STYLE: { readonly [K in keyof MotionStyle]: readonly MotionStyle[K][] } = {
  speed: ["normal", "slower", "faster"],
  intensity: ["normal", "subtle", "strong"],
  spotlight: ["glow_and_trace", "glow", "trace"],
  pack: ["standard", "broadcast", "arcade"],
};

export const DEFAULT_MOTION_STYLE: MotionStyle = {
  speed: "normal",
  intensity: "normal",
  spotlight: "glow_and_trace",
  pack: "standard",
};

/** Each field as given, else its default; an unknown value counts as unset. */
export function motionStyleOf(given: unknown): MotionStyle {
  const g = (typeof given === "object" && given !== null ? given : {}) as Record<string, unknown>;
  const pick = <K extends keyof MotionStyle>(k: K): MotionStyle[K] =>
    MOTION_STYLE[k].find((v) => v === g[k]) ?? DEFAULT_MOTION_STYLE[k];
  return {
    speed: pick("speed"),
    intensity: pick("intensity"),
    spotlight: pick("spotlight"),
    pack: pick("pack"),
  };
}

/** The energy levels, lowest first. */
export const MOTION_LEVELS = ["none", "calm", "lively", "party"] as const;
export type MotionLevel = (typeof MOTION_LEVELS)[number];

/** The three ways of moving that predate the levels: `display.motion`, the theme's cap, transitions. */
export type LegacyMotion = "moderate" | "calm" | "none";

/** `display.motion` for older players, and the region transitions and ticker of every player. */
export const legacyMotion = (level: MotionLevel): LegacyMotion =>
  level === "lively" || level === "party" ? "moderate" : level;
