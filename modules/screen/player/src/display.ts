/**
 * How the screen moves (contracts/screen.md, Motion and burn-in drift). The zone's `motion` comes
 * from the server; the player lowers it once more under `prefers-reduced-motion`, never raises it.
 */

export type Motion = "moderate" | "calm" | "none";
const MOTIONS: readonly Motion[] = ["moderate", "calm", "none"];

/** How long a widget takes to fade in and out: `calm` keeps only slow fades, `none` swaps at once. */
export const FADE_MS: Readonly<Record<Motion, number>> = { moderate: 600, calm: 1500, none: 0 };

export function effectiveMotion(zone: unknown, reducedMotion: boolean): Motion {
  if (reducedMotion) return "none";
  return MOTIONS.find((m) => m === zone) ?? "moderate";
}

/**
 * The drift's direction at minute `m` of the server's hour, a unit vector the CSS scales by a
 * quarter of the theme's `safe_inset`: one step a minute, a full circle in an hour.
 */
export function driftAt(serverMs: number): { x: number; y: number } {
  const minute = Math.floor(serverMs / 60_000) % 60;
  const angle = (2 * Math.PI * minute) / 60;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
