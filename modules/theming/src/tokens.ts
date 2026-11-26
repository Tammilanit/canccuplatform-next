/** The token set of a theme, its defaults and its CSS (contracts/theming.md, Stable classes). */
import {
  COLOR_TOKENS,
  FONT_STACKS,
  MOTION_STYLE,
  cssVar,
  motionStyleOf,
  resolveTheme,
} from "@canccu/ui";
import type { FontToken, MotionStyle } from "@canccu/ui";
import { brandTokens } from "./brand.js";
import type { Brand } from "./brand.js";
import { isObject } from "./checks.js";
import type { Manifest } from "./checks.js";
import { contrastFailures } from "./contrast.js";
import { FONT_PAIRS, pairFontFaces } from "./font-pairs.js";
import { plateOf, plateVars } from "./logo-plate.js";

export interface Tokens {
  colors: Record<string, string>;
  fonts: Record<string, string>;
  sizes: Record<string, string>;
}

export interface PartialTokens {
  colors?: Record<string, unknown>;
  fonts?: Record<string, unknown>;
  sizes?: Record<string, unknown>;
}

// The `motion_style` token's choices are the shared vocabulary's (packages/ui, motion.ts).
export { MOTION_STYLE, motionStyleOf };
export type { MotionStyle };
const SPEED_FACTOR = { slower: 1.4, normal: 1, faster: 0.75 } as const;
const INTENSITY_FACTOR = { subtle: 0.6, normal: 1, strong: 1.4 } as const;

/** A theme's tokens as revisions keep them: every token filled in, plus `motion` and `motion_style` when set. */
export type ThemeTokens = Tokens & { motion?: string; motion_style?: Partial<MotionStyle> };

export function themeTokens(given: unknown): ThemeTokens {
  const g = (typeof given === "object" && given !== null ? given : {}) as PartialTokens & {
    motion?: unknown;
    motion_style?: unknown;
  };
  const tokens: ThemeTokens = fillTokens(g);
  if (typeof g.motion === "string") tokens.motion = g.motion;
  if (typeof g.motion_style === "object" && g.motion_style !== null) {
    tokens.motion_style = g.motion_style;
  }
  return tokens;
}

const brandOf = (manifest: Manifest): Partial<Brand> =>
  isObject(manifest.brand) ? manifest.brand : {};

/**
 * A manifest's tokens as a revision keeps them: the brand's choices (its font pair and roundness,
 * plan issue-784 D6, D7) under the tokens the theme sets, so an advanced token wins over a choice.
 */
export function manifestTokens(manifest: Manifest): ThemeTokens {
  const given = isObject(manifest.tokens) ? manifest.tokens : {};
  const generated = brandTokens(brandOf(manifest));
  const group = (name: "fonts" | "sizes"): Record<string, unknown> | undefined => {
    const own = isObject(given[name]) ? given[name] : undefined;
    const made = generated[name];
    return made === undefined ? own : { ...made, ...own };
  };
  const fonts = group("fonts");
  const sizes = group("sizes");
  return themeTokens({
    ...given,
    ...(fonts === undefined ? {} : { fonts }),
    ...(sizes === undefined ? {} : { sizes }),
  });
}

/**
 * The token CSS of a manifest: `tokensCss` of `tokens` (the theme's, or the admin pages' colours)
 * with the logo plate's custom properties and the font pair's `@font-face` rules. A theme without
 * those choices gets exactly the CSS it got before them.
 */
export function manifestCss(manifest: Manifest, tokens: ThemeTokens): string {
  const pairId = brandOf(manifest).font_pair;
  const pair = typeof pairId === "string" ? FONT_PAIRS.get(pairId) : undefined;
  return tokensCss(
    tokens,
    pair === undefined ? [] : pairFontFaces(pair),
    plateVars(plateOf(manifest)),
  );
}

const GENERIC_FAMILIES = new Set(["system-ui", "ui-monospace", "sans-serif", "serif", "monospace"]);

/**
 * Every token, the given ones over the platform defaults; unknown names and bad values dropped.
 * Values land in CSS, so the check is packages/ui's, the one guard admin pages use as well.
 */
export function fillTokens(given: PartialTokens): Tokens {
  return resolveTheme({ theme: given });
}

export function platformTokens(): Tokens {
  return fillTokens({});
}

/** The family quoted unless generic, then the platform's fallback without repeating the family. */
export function fontValue(token: string, family: string): string {
  const stack = (
    Object.hasOwn(FONT_STACKS, token) ? FONT_STACKS[token as FontToken] : "system-ui, sans-serif"
  )
    .split(", ")
    .filter((f) => f !== family);
  const first = GENERIC_FAMILIES.has(family) ? family : `"${family}"`;
  return [first, ...stack].join(", ");
}

/**
 * A `:root` block of every token, then the `@font-face` rules; tokens must be filled. The motion
 * factors are always there, at their defaults when the theme sets no `motion_style`.
 */
export function tokensCss(
  tokens: Tokens & { motion_style?: unknown },
  fontFaces: readonly string[] = [],
  extraVars: readonly string[] = [],
): string {
  const style = motionStyleOf(tokens.motion_style);
  const lines = [
    ...Object.entries(tokens.colors).map(([n, v]) => `  ${cssVar("color", n)}: ${v};`),
    ...Object.entries(tokens.fonts).map(([n, v]) => `  ${cssVar("font", n)}: ${fontValue(n, v)};`),
    ...Object.entries(tokens.sizes).map(([n, v]) => `  ${cssVar("size", n)}: ${v};`),
    `  --canccu-motion-speed: ${SPEED_FACTOR[style.speed]};`,
    `  --canccu-motion-intensity: ${INTENSITY_FACTOR[style.intensity]};`,
    ...extraVars,
  ];
  return [`:root {\n${lines.join("\n")}\n}\n`, ...fontFaces].join("\n");
}

/**
 * The tokens admin and sign-in pages use: the theme's own, unless its colours break a contrast
 * rule; then the platform colours with the theme's fonts and sizes, so look-alike or unreadable
 * controls never reach the pages where rights are granted (contracts/theming.md, What applies where).
 */
export function adminTokens(tokens: Tokens): Tokens {
  if (contrastFailures(tokens.colors).length === 0) return tokens;
  return { ...tokens, colors: { ...COLOR_TOKENS } };
}
