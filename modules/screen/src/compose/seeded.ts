/**
 * The seeded shuffle the composed state shares with the player (player/src/rotation.ts): rotation
 * shuffles and the photo wall's `shuffle` order come out alike on every screen of a zone.
 */

/** mulberry32 over a string hash: small, and the same in every container and every reload. */
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

/** A seeded Fisher–Yates: the same order for the same seed, in every container and every reload. */
export function shuffled<T>(order: readonly T[], seed: string): T[] {
  const out = [...order];
  const random = seeded(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
