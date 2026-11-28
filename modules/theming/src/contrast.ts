/** WCAG 2.2 contrast and the theming contract's contrast rules (contracts/theming.md, Brand kit). */

/** [foreground, background, minimum ratio], in the order the contract lists them. */
const RULES: readonly (readonly [string, string, number])[] = [
  ["text", "background", 4.5],
  ["text", "surface", 4.5],
  ["text_muted", "background", 4.5],
  ["text_muted", "surface", 4.5],
  ["primary_text", "primary", 4.5],
  ["primary_text", "status_down", 4.5],
  ["primary", "background", 3],
  ["accent", "background", 3],
  ["status_ok", "surface", 3],
  ["status_degraded", "surface", 3],
  ["status_down", "surface", 3],
];

function channel(hex: string, at: number): number {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// The alpha of `#rrggbbaa` is ignored: what a translucent token sits on differs per page, so the
// rules judge its solid colour.
function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The pairs that break the rules, as `"<token> on <token>"`; empty when every rule holds. */
export function contrastFailures(colors: Readonly<Record<string, string>>): string[] {
  const failures: string[] = [];
  for (const [fg, bg, min] of RULES) {
    const a = colors[fg];
    const b = colors[bg];
    if (a === undefined || b === undefined || contrastRatio(a, b) < min) {
      failures.push(`${fg} on ${bg}`);
    }
  }
  return failures;
}

/** The platform's box opacity (plan issue-785 D11): a subtle transparency, the background shows through. */
export const BOX_OPACITY = 0.9;

/** What the stage draws behind a box: its background, and the primary and accent of its glows. */
const GROUNDS = ["background", "primary", "accent"] as const;
/**
 * The least scrim the stage lays over a picture, a video or art (contracts/theming.md, The two
 * backgrounds: 0.55–1): the theme's background at it over pure white and over pure black is the
 * lightest and the darkest any media can make the ground under a box. Judged always, not only for
 * a theme with its own picture: the game's art and a box's art may come with any theme.
 */
const MEDIA_SCRIM = 0.55;
const ON_BOX: readonly (readonly [string, number])[] = RULES.filter(
  ([, bg]) => bg === "surface",
).map(([fg, , min]) => [fg, min] as const);

/** A token's own alpha: that of `#rrggbbaa`, else 1. */
const alphaOf = (hex: string): number =>
  hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;

/**
 * `top` at `alpha` over `ground`, as `color-mix(in srgb, …)` draws it: a `#rrggbbaa` top's own
 * alpha multiplies in, since the mix keeps it.
 */
function over(top: string, ground: string, alpha: number): string {
  const a = alpha * alphaOf(top);
  const mix = [1, 3, 5].map((at) => {
    const c = parseInt(top.slice(at, at + 2), 16) * a;
    return Math.round(c + parseInt(ground.slice(at, at + 2), 16) * (1 - a));
  });
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The contrast rules on a box of `surface` at `opacity`, checked over each colour the stage may
 * draw behind it (the worst point of the screen), as `"<token> on the box over <ground>"`.
 */
export function boxContrastFailures(
  colors: Readonly<Record<string, string>>,
  opacity: number,
): string[] {
  const surface = colors.surface;
  const background = colors.background;
  if (surface === undefined) return [];
  const grounds: [string, string | undefined][] = GROUNDS.map((g) => [g, colors[g]]);
  if (background !== undefined) {
    grounds.push(["light media", over(background, "#ffffff", MEDIA_SCRIM)]);
    grounds.push(["dark media", over(background, "#000000", MEDIA_SCRIM)]);
  }
  const failures: string[] = [];
  for (const [name, g] of grounds) {
    if (g === undefined) continue;
    const box = over(surface, g, opacity);
    for (const [fg, min] of ON_BOX) {
      const a = colors[fg];
      if (a === undefined || contrastRatio(a, box) < min)
        failures.push(`${fg} on the box over ${name}`);
    }
  }
  return failures;
}

/** The lowest opacity, in steps of 0.05 from 0.5, at which the boxes pass; 1 when only opaque does. */
export function minBoxOpacity(colors: Readonly<Record<string, string>>): number {
  for (let step = 10; step < 20; step++) {
    if (boxContrastFailures(colors, step / 20).length === 0) return step / 20;
  }
  return 1;
}

/** The opacity a theme's boxes get: its own (else the platform's), never under what its colours allow. */
export const boxOpacityFor = (colors: Readonly<Record<string, string>>, own: unknown): number =>
  Math.max(typeof own === "number" ? own : BOX_OPACITY, minBoxOpacity(colors));
