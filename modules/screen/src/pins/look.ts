/** What a pin changes in what screens draw (contracts/screen.md, Pins): the theme revision. */
import type { Sources, ThemeNow } from "../compose/sources.js";
import type { PinValues } from "./store.js";

/**
 * The pinned revision, else the current one. A pinned read that fails falls back to the current
 * theme too: a screen keeps the event's look rather than going to the platform's defaults.
 */
export async function themeFor(
  sources: Pick<Sources, "theme" | "themeRevision">,
  tenantId: string,
  pin: PinValues,
): Promise<ThemeNow | null> {
  if (pin.theme_revision !== null) {
    const pinned = await sources.themeRevision(tenantId, pin.theme_revision);
    if (pinned !== null) return pinned;
  }
  return sources.theme(tenantId);
}
