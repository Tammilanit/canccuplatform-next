/**
 * How the screen's regions and ticker move and drift (contracts/screen.md, Motion and burn-in
 * drift); the level they follow is motion.ts's.
 */
import type { LegacyMotion } from "@canccu/ui";

export type Motion = LegacyMotion;

/** How long a widget takes to fade in and out: `calm` keeps only slow fades, `none` swaps at once. */
export const FADE_MS: Readonly<Record<Motion, number>> = { moderate: 600, calm: 1500, none: 0 };

/**
 * The drift's direction at minute `m` of the server's hour, a unit vector the CSS scales by a
 * quarter of the theme's `safe_inset`: one step a minute, a full circle in an hour.
 */
export function driftAt(serverMs: number): { x: number; y: number } {
  const minute = Math.floor(serverMs / 60_000) % 60;
  const angle = (2 * Math.PI * minute) / 60;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
