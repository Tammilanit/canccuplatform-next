/**
 * What the screen (screen.ts) compares between draws: a layout's and a rotation's keys, so a push
 * that renews only the widgets' data keeps the DOM, and how a storyboard's steps hand over.
 */
import type { Layout, Region } from "./state.js";

/** `16:9` → 16/9; anything else the built-in shape. */
export function ratioOf(aspect: string): number {
  const [w, h] = aspect.split(":").map(Number);
  return w !== undefined && h !== undefined && w > 0 && h > 0 ? w / h : 16 / 9;
}

export const layoutKey = (l: Layout): string =>
  JSON.stringify([l.id, l.aspect, l.grid.columns, l.grid.rows]);

/** What `shownAt` reads of a region, not the widgets' data, which every push may renew. */
export const rotationKey = (r: Region): string =>
  JSON.stringify([r.rotation, r.order, r.widgets.map((w) => w.dwell_seconds)]);

/**
 * A storyboard's step hands over to the next by leaving first, then the next fades in: crossfaded,
 * two steps' text lay over each other ("Midnight!" through "Night 2 at …", S2, #625). A claim's
 * step key is `claim:<id>:<n>` (claims.ts).
 */
const isStep = (key: string | undefined): boolean =>
  key?.startsWith("claim:") === true && key.split(":").length === 3;
export const outFirst = (from: string | undefined, to: string | undefined): boolean =>
  (isStep(from) && to?.startsWith("claim:") === true) ||
  (isStep(to) && from?.startsWith("claim:") === true);
