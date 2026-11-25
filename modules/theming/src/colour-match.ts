/**
 * The colour suggestions under the Studio's pickers (plan issue-784 D13): the logo's own colours,
 * and the matches of a colour on the colour wheel, each shaded until it reads on the background.
 */
import { fillOn, turnHue } from "./brand.js";
import type { Rgba } from "./logo-plate.js";

const MOST = 5;
const OPAQUE = 128;

type Pixel = [number, number, number];

const hex = ([r, g, b]: Pixel): string =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

const range = (box: Pixel[], ch: number): number => {
  let [lo, hi] = [255, 0];
  for (const p of box) [lo, hi] = [Math.min(lo, p[ch] ?? 0), Math.max(hi, p[ch] ?? 0)];
  return hi - lo;
};

/**
 * Splits `box` on its widest channel where the value changes nearest its middle, so two flat
 * colours never end up mixed in one half.
 */
function split(box: Pixel[]): [Pixel[], Pixel[]] | undefined {
  const ch = [0, 1, 2].reduce((a, b) => (range(box, b) > range(box, a) ? b : a));
  if (range(box, ch) === 0) return undefined;
  const sorted = [...box].sort((p, q) => (p[ch] ?? 0) - (q[ch] ?? 0));
  const mid = sorted.length / 2;
  let at = -1;
  for (let i = 1; i < sorted.length; i++) {
    if (
      sorted[i - 1]?.[ch] !== sorted[i]?.[ch] &&
      (at < 0 || Math.abs(i - mid) < Math.abs(at - mid))
    )
      at = i;
  }
  return [sorted.slice(0, at), sorted.slice(at)];
}

/** Up to five colours of the logo's opaque pixels (median cut), the most used first. */
export function logoPalette(rgba: Rgba): string[] {
  const pixels: Pixel[] = [];
  const { data } = rgba;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if ((data[i + 3] ?? 0) >= OPAQUE)
      pixels.push([data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]);
  }
  if (pixels.length === 0) return [];
  let boxes: Pixel[][] = [pixels];
  while (boxes.length < MOST) {
    // The widest box splits next; a box of one colour cannot.
    const order = boxes
      .map((box, i) => ({ i, width: Math.max(range(box, 0), range(box, 1), range(box, 2)) }))
      .sort((a, b) => b.width - a.width || (boxes[b.i]?.length ?? 0) - (boxes[a.i]?.length ?? 0));
    const halves = order[0] === undefined ? undefined : split(boxes[order[0].i] ?? []);
    if (order[0] === undefined || halves === undefined) break;
    boxes = [...boxes.filter((_, i) => i !== order[0]?.i), ...halves];
  }
  return boxes
    .sort((a, b) => b.length - a.length)
    .map((box) => {
      const sum = box.reduce<Pixel>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]);
      return hex([sum[0] / box.length, sum[1] / box.length, sum[2] / box.length]);
    });
}

/** Analogous (−30°, +30°), complementary (180°) and split (150°, −150°), in OKLCH hue. */
const TURNS = [-30, 30, 180, 150, -150];

export function matchesFor(colour: string, background: string): string[] {
  return TURNS.map((deg) => fillOn(turnHue(colour, deg), background));
}
