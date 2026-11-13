/** What a pin changes in what screens draw (contracts/screen.md, Pins): the theme revision. */
import type { Sources, ThemeNow } from "../compose/sources.js";
import type { PinValues } from "./store.js";

/**
 * The pinned revision, else the current one. A pinned read that fails, or finds the revision gone,
 * falls back to the current theme too: a screen keeps the event's look rather than the defaults.
 */
export async function themeFor(
  sources: Pick<Sources, "theme" | "themeRevision">,
  tenantId: string,
  pin: PinValues,
): Promise<ThemeNow | null> {
  if (pin.theme_revision !== null) {
    const pinned = await sources.themeRevision(tenantId, pin.theme_revision);
    if (pinned !== null && pinned !== "gone") return pinned;
  }
  return sources.theme(tenantId);
}
