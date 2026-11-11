/**
 * `ScreenState.display` (contracts/screen.md, Motion and burn-in drift): how the zone's screens
 * move. The player lowers `motion` once more under `prefers-reduced-motion`; nothing raises it.
 */
import type { AgendaNow } from "./widgets.js";

export type Motion = "moderate" | "calm" | "none";
export interface Display {
  motion: Motion;
  drift: boolean;
}

const MOTIONS: readonly Motion[] = ["moderate", "calm", "none"];

export function displayOf(
  tokens: { motion?: unknown } | undefined,
  agenda: AgendaNow | null,
  burnInDrift: unknown,
): Display {
  const themed = MOTIONS.find((m) => m === tokens?.motion) ?? "moderate";
  // The agenda's zone read already keeps only the zone's items and those for every zone.
  const quiet =
    agenda?.current.some((i) => i.kind === "quiet_hours" && i.visibility === "public") ?? false;
  return {
    motion: quiet && themed === "moderate" ? "calm" : themed,
    drift: burnInDrift === true,
  };
}
