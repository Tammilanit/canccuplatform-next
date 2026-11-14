/**
 * The stage's scrim and a card's veil (contracts/screen.md, The stage, The computed scrim): the
 * least opacity of a theme colour over an image at which the theme's `text` keeps 4.5:1 against
 * the image's lightest and its darkest colour. Pure: the colours come in, so every bound and theme
 * case is tested without an image.
 */

export type Rgb = readonly [number, number, number];
/** A theme colour: its channels and its alpha, 0–1 (theming allows `#rrggbbaa`). */
export type Rgba = readonly [number, number, number, number];
type Colour = Rgb | Rgba;

/** The lightest and darkest colour of an image, read from a small version of it (art.ts). */
export interface Extremes {
  light: Rgb;
  dark: Rgb;
}

const MIN_RATIO = 4.5;
const STEP = 0.05;
export const SCRIM_FROM = 0.55;
export const VEIL_FROM = 0.5;

/** `#rgb`, `#rrggbb` or `#rrggbbaa` (theming's colour tokens); null for anything else. */
export function parseHex(value: unknown): Rgba | null {
  if (typeof value !== "string") return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  const hex = m?.[1];
  if (hex === undefined) return null;
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  const byte = (i: number): number => parseInt(full.slice(i, i + 2), 16);
  return [byte(0), byte(2), byte(4), full.length === 8 ? byte(6) / 255 : 1];
}

const rgbOf = (c: Colour): Rgb => [c[0], c[1], c[2]];
const alphaOf = (c: Colour): number => (c.length === 4 ? c[3] : 1);

const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: Colour): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** WCAG's contrast ratio, as theming checks its tokens. */
export function contrast(a: Colour, b: Colour): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `over` at `alpha` on top of `under`, as the browser composites it (in sRGB). */
const mix = (over: Rgb, under: Rgb, alpha: number): Rgb =>
  over.map((c, i) => c * alpha + (under[i] ?? 0) * (1 - alpha)) as unknown as Rgb;

/**
 * `text` on `ground` at `opacity` over `image`, composited as the browser draws them: a
 * translucent colour lets what is under it through, so its alpha scales the layer's opacity.
 */
function reads(ground: Colour, text: Colour, image: Rgb, opacity: number): boolean {
  const under = mix(rgbOf(ground), image, opacity * alphaOf(ground));
  return contrast(mix(rgbOf(text), under, alphaOf(text)), under) >= MIN_RATIO;
}

/**
 * The least opacity from `from` to 1, in steps of 0.05, at which `text` reads on `ground` laid
 * over both of the image's extremes. 1 when no step does: the most of the image the ground can
 * cover (all of it for an opaque ground, whose text the theme's own contrast check holds).
 */
export function leastOpacity(ground: Colour, text: Colour, image: Extremes, from: number): number {
  const steps = Math.round((1 - from) / STEP);
  for (let i = 0; i <= steps; i++) {
    const alpha = Math.round((from + i * STEP) * 100) / 100;
    if (reads(ground, text, image.light, alpha) && reads(ground, text, image.dark, alpha)) {
      return alpha;
    }
  }
  return 1;
}

/** The colours the scrim and veil are worked out from: the theme's, else the platform defaults (ui.css). */
export interface ThemeColors {
  background: Rgba;
  surface: Rgba;
  text: Rgba;
}

const DEFAULTS: ThemeColors = {
  background: [0x0f, 0x17, 0x2a, 1],
  surface: [0x1e, 0x29, 0x3b, 1],
  text: [0xf8, 0xfa, 0xfc, 1],
};

/** The theme's `colors` token (complete, defaults filled in by theming), or the platform's. */
export function themeColors(tokens: { colors?: unknown } | undefined): ThemeColors {
  const c = (tokens?.colors ?? {}) as Record<string, unknown>;
  return {
    background: parseHex(c.background) ?? DEFAULTS.background,
    surface: parseHex(c.surface) ?? DEFAULTS.surface,
    text: parseHex(c.text) ?? DEFAULTS.text,
  };
}

export const scrimOf = (colors: ThemeColors, art: Extremes): number =>
  leastOpacity(colors.background, colors.text, art, SCRIM_FROM);

export const veilOf = (colors: ThemeColors, image: Extremes): number =>
  leastOpacity(colors.surface, colors.text, image, VEIL_FROM);
