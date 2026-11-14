/**
 * Which widget a rotating region shows at a moment (contracts/screen.md, The Pulse options). The
 * server's push leaves cycles and shuffles out (src/push/diff.ts), so the player keeps them
 * itself, on the server's clock: cycles are anchored on the epoch and a shuffle is seeded by zone,
 * region and cycle exactly as src/compose/build.ts does, so every screen of a zone agrees, also
 * offline and across reloads. test/player-rotation.test.ts holds the two to one answer. The
 * Director (`director`) turns as `sequence` does through its order, after any queue jump.
 */
import { jumpAt } from "./director.js";

export interface Rotating {
  id: string;
  rotation: string;
  /** The widgets that take part (the non-empty ones), in the state's cycle order. */
  order: number[];
  widgets: { dwell_seconds: number; widget?: string; view?: Record<string, unknown> }[];
}

/** mulberry32 over a string hash, as the server seeds it. */
function seeded(seed: string): () => number {
  let h = 1779033703;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(order: number[], seed: string): number[] {
  const out = [...order];
  const random = seeded(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as number, out[i] as number];
  }
  return out;
}

/** The widget shown at `nowMs` (null: none takes part) and when that changes. */
export function shownAt(
  region: Rotating,
  zoneKey: string,
  nowMs: number,
): { index: number | null; until: number } {
  const jump = region.rotation === "director" ? jumpAt(region.widgets, region.order, nowMs) : null;
  if (jump !== null) return jump;
  const dwellMs = (i: number): number => (region.widgets[i]?.dwell_seconds ?? 0) * 1000;
  // A shuffled order is a permutation of the plain one, which lists the widgets in place order.
  const plain =
    region.rotation === "shuffle" ? [...region.order].sort((a, b) => a - b) : region.order;
  const cycleMs = plain.reduce((sum, i) => sum + dwellMs(i), 0);
  if (cycleMs <= 0) return { index: null, until: Infinity };
  const cycle = Math.floor(nowMs / cycleMs);
  const order =
    region.rotation === "shuffle" ? shuffled(plain, `${zoneKey}:${region.id}:${cycle}`) : plain;
  let end = cycle * cycleMs;
  for (const i of order) {
    end += dwellMs(i);
    if (nowMs < end) return { index: i, until: end };
  }
  return { index: null, until: Infinity };
}
