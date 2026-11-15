/** What a pin changes in what screens draw (contracts/screen.md, Pins): the theme revision. */
import type { Sources, ThemeNow } from "../compose/sources.js";
import type { PinValues } from "./store.js";

/** Pinned looks kept; past it the oldest goes first, so the memory stays bounded. */
const MAX_KEPT = 256;

/**
 * The last good read of each event's pinned revision. A revision never changes, so a copy is never
 * stale and each container may keep its own: it only bridges a read that fails, which would
 * otherwise flip the screens to the current theme and back on the next build.
 */
const lastGood = new Map<string, ThemeNow>();

/**
 * The pinned revision, else the current one. A pinned read that fails draws the last good read of
 * that revision; with none, or with the revision gone, the current theme: a screen keeps the
 * event's look rather than the defaults.
 */
export async function themeFor(
  sources: Pick<Sources, "theme" | "themeRevision">,
  tenantId: string,
  pin: PinValues,
): Promise<ThemeNow | null> {
  if (pin.theme_revision !== null) {
    const key = `${tenantId}\n${pin.theme_revision}`;
    const pinned = await sources.themeRevision(tenantId, pin.theme_revision);
    if (pinned === "gone") lastGood.delete(key);
    else if (pinned !== null) {
      lastGood.delete(key);
      lastGood.set(key, pinned);
      if (lastGood.size > MAX_KEPT) lastGood.delete(lastGood.keys().next().value as string);
      return pinned;
    } else {
      const kept = lastGood.get(key);
      if (kept !== undefined) return kept;
    }
  }
  return sources.theme(tenantId);
}
