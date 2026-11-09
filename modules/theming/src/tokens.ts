/** The token set of a theme, its defaults and its CSS (contracts/theming.md, Stable classes). */
import { COLOR_TOKENS, FONT_STACKS, cssVar, resolveTheme } from "@canccu/ui";
import type { FontToken } from "@canccu/ui";
import { contrastFailures } from "./contrast.js";

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

/** A `:root` block of every token, then the `@font-face` rules; tokens must be filled. */
export function tokensCss(tokens: Tokens, fontFaces: readonly string[] = []): string {
  const lines = [
    ...Object.entries(tokens.colors).map(([n, v]) => `  ${cssVar("color", n)}: ${v};`),
    ...Object.entries(tokens.fonts).map(([n, v]) => `  ${cssVar("font", n)}: ${fontValue(n, v)};`),
    ...Object.entries(tokens.sizes).map(([n, v]) => `  ${cssVar("size", n)}: ${v};`),
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
