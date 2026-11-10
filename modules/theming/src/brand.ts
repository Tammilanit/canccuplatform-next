/**
 * The simple mode's colour generation (contracts/theming.md, Brand kit; plan D5, D6): from a brand's
 * `primary`, `accent` and `scheme` to every colour token, under the contrast rules. Deterministic:
 * the golden tests pin its output, since a change here changes every simple theme's screenshots.
 */
import { COLOR_TOKENS } from "@canccu/ui";
import { contrastRatio } from "./contrast.js";

export interface Brand {
  primary: string;
  accent: string;
  scheme: "dark" | "light";
  embed_color?: string;
}

export type Colors = Record<keyof typeof COLOR_TOKENS, string>;

export interface Generated {
  colors: Colors;
  /** The given colours (`primary`, `accent`) that had to be shaded to meet the rules. */
  adjusted: string[];
}

type Neutral = "background" | "surface" | "border" | "text" | "text_muted";

/**
 * The neutral tokens per scheme (D6). Dark is the platform's own, so the default brand gives the
 * platform defaults back exactly; light is its counterpart from the same slate family.
 */
const PALETTES: Record<Brand["scheme"], Record<Neutral, string>> = {
  dark: {
    background: COLOR_TOKENS.background,
    surface: COLOR_TOKENS.surface,
    border: COLOR_TOKENS.border,
    text: COLOR_TOKENS.text,
    text_muted: COLOR_TOKENS.text_muted,
  },
  light: {
    background: "#f8fafc",
    surface: "#ffffff",
    border: "#cbd5e1",
    text: "#0f172a",
    text_muted: "#475569",
  },
};

const WHITE = "#ffffff";
const BLACK = "#000000";
/** One step of the shade search in OKLCH lightness: small enough to stay close to the given colour. */
const STEP = 0.005;

type Lab = [number, number, number];

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;

/** `#rrggbb[aa]` → OKLab (Björn Ottosson's matrices); the alpha is dropped. */
function oklab(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map((at) => toLinear(parseInt(hex.slice(at, at + 2), 16) / 255)) as [
    number,
    number,
    number,
  ];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function linearRgb([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const EPSILON = 1e-7;
const inGamut = (rgb: number[]): boolean => rgb.every((c) => c >= -EPSILON && c <= 1 + EPSILON);

/**
 * The sRGB colour of lightness `L` with the hue of `a`, `b`: where that leaves sRGB, the chroma is
 * reduced (a fixed bisection) rather than the channels clipped, which would shift the hue.
 */
function hexAt(L: number, a: number, b: number): string {
  let rgb = linearRgb([L, a, b]);
  if (!inGamut(rgb)) {
    let [lo, hi] = [0, 1];
    for (let i = 0; i < 24; i++) {
      const k = (lo + hi) / 2;
      if (inGamut(linearRgb([L, a * k, b * k]))) lo = k;
      else hi = k;
    }
    rgb = linearRgb([L, a * lo, b * lo]);
  }
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, c))))) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const opaque = (hex: string): string => hex.slice(0, 7).toLowerCase();

/**
 * The first shade of `hex` that `ok` accepts, moving its lightness in fixed steps towards white
 * (`dir` 1) or black (-1); `hex` itself when it passes, undefined when no shade does.
 */
function shade(hex: string, ok: (c: string) => boolean, dir: 1 | -1): string | undefined {
  const start = opaque(hex);
  if (ok(start)) return start;
  const [L, a, b] = oklab(start);
  for (let i = 1; ; i++) {
    const at = Math.min(1, Math.max(0, L + dir * i * STEP));
    const c = hexAt(at, a, b);
    if (ok(c)) return c;
    if (at === 0 || at === 1) return undefined;
  }
}

/** Lighter or darker than `ref`, whichever moves away from it. */
const awayFrom = (hex: string, ref: string): 1 | -1 =>
  contrastRatio(hex, WHITE) > contrastRatio(ref, WHITE) ? -1 : 1;

export function generateColors(brand: Brand): Generated {
  const neutral = PALETTES[brand.scheme];
  const { background, surface } = neutral;
  // Fills move away from the page: lighter on dark, darker on light. The extreme (white or black)
  // passes every rule against either palette, so these searches always end with a colour.
  const away = brand.scheme === "dark" ? 1 : -1;
  const fill = (hex: string, on: string): string =>
    shade(hex, (c) => contrastRatio(c, on) >= 3, away) as string;

  const primary = fill(brand.primary, background);
  const accent = fill(brand.accent, background);
  const statusOk = fill(COLOR_TOKENS.status_ok, surface);
  const statusDegraded = fill(COLOR_TOKENS.status_degraded, surface);

  // primary_text must read on primary and on status_down: the first of background, white and
  // black that reads on primary (white or black always does), with status_down shaded from the
  // platform's red until the text reads on it too. That red depends only on the scheme and the
  // text chosen, and each of those six pairs has one (the golden tests hold them all).
  const primaryText = [background, WHITE, BLACK].find(
    (text) => contrastRatio(text, primary) >= 4.5,
  ) as string;
  const statusDown = shade(
    COLOR_TOKENS.status_down,
    (c) => contrastRatio(c, surface) >= 3 && contrastRatio(primaryText, c) >= 4.5,
    awayFrom(COLOR_TOKENS.status_down, primaryText),
  ) as string;

  const colors: Colors = {
    ...neutral,
    primary,
    primary_text: primaryText,
    accent,
    status_ok: statusOk,
    status_degraded: statusDegraded,
    status_down: statusDown,
  };
  const adjusted = (["primary", "accent"] as const).filter((t) => colors[t] !== opaque(brand[t]));
  return { colors: orderLike(colors), adjusted };
}

/** The tokens in the platform's order, so stored and served token CSS reads the same each time. */
function orderLike(colors: Colors): Colors {
  return Object.fromEntries(
    Object.keys(COLOR_TOKENS).map((k) => [k, colors[k as keyof Colors]]),
  ) as Colors;
}
