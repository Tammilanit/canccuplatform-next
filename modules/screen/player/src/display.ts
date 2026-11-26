/**
 * How the screen's regions and ticker move and drift (contracts/screen.md, Motion and burn-in
 * drift); the level they follow is motion.ts's.
 */
import type { LegacyMotion } from "@canccu/ui";

export type Motion = LegacyMotion;

/**
 * How long a widget takes to fade in and out. Never a cut (#787 D5): a turn is a crossfade with
 * the motion pack's move at `calm` and above, and an opacity crossfade alone at `none` and under
 * reduced motion, since a fade is not motion in that sense and a cut is what made the screen dull.
 */
export const FADE_MS: Readonly<Record<Motion, number>> = { moderate: 1200, calm: 1200, none: 400 };

/**
 * The drift's direction at minute `m` of the server's hour, a unit vector the CSS scales by a
 * quarter of the theme's `safe_inset`: one step a minute, a full circle in an hour.
 */
export function driftAt(serverMs: number): { x: number; y: number } {
  const minute = Math.floor(serverMs / 60_000) % 60;
  const angle = (2 * Math.PI * minute) / 60;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
