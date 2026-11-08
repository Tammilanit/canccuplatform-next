import {
  COLOR_TOKENS,
  FONT_STACKS,
  FONT_TOKENS,
  SIZE_TOKENS,
  cssVar,
  type ColorToken,
  type FontToken,
  type SizeToken,
} from "./tokens.js";

/** The parts of a profile (contracts/profile.md) the UI reads. Values may be unvalidated. */
export interface ProfileLike {
  theme?: {
    colors?: Record<string, unknown>;
    fonts?: Record<string, unknown>;
    sizes?: Record<string, unknown>;
  };
  logos?: Record<string, unknown>;
}

export interface ResolvedTheme {
  colors: Record<ColorToken, string>;
  fonts: Record<FontToken, string>;
  sizes: Record<SizeToken, string>;
}

const COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FONT = /^[A-Za-z0-9 _-]{1,64}$/;
// Same pattern as $defs.length in contracts/theme.schema.json
const LENGTH = /^(0|[0-9]{1,3}(\.[0-9]{1,3})?(px|rem|em))$/;
// Base64 and base64url characters; the length floor refuses guessable nonces
const NONCE = /^[A-Za-z0-9+/=_-]{16,}$/;

function isKnown<T extends object>(table: T, name: string): name is Extract<keyof T, string> {
  return Object.hasOwn(table, name);
}

/** Profile overrides that are known tokens with safe values; everything else is dropped. */
function overrides(profile: ProfileLike | undefined): {
  colors: Partial<Record<ColorToken, string>>;
  fonts: Partial<Record<FontToken, string>>;
  sizes: Partial<Record<SizeToken, string>>;
} {
  const colors: Partial<Record<ColorToken, string>> = {};
  const fonts: Partial<Record<FontToken, string>> = {};
  const sizes: Partial<Record<SizeToken, string>> = {};
  for (const [name, value] of Object.entries(profile?.theme?.colors ?? {})) {
    if (isKnown(COLOR_TOKENS, name) && typeof value === "string" && COLOR.test(value)) {
      colors[name] = value;
    }
  }
  for (const [name, value] of Object.entries(profile?.theme?.fonts ?? {})) {
    if (isKnown(FONT_TOKENS, name) && typeof value === "string" && FONT.test(value)) {
      fonts[name] = value;
    }
  }
  for (const [name, value] of Object.entries(profile?.theme?.sizes ?? {})) {
    if (isKnown(SIZE_TOKENS, name) && typeof value === "string" && LENGTH.test(value)) {
      sizes[name] = value;
    }
  }
  return { colors, fonts, sizes };
}

/** The profile's theme merged over the defaults. Unknown keys and bad values are ignored. */
export function resolveTheme(profile?: ProfileLike): ResolvedTheme {
  const o = overrides(profile);
  return {
    colors: { ...COLOR_TOKENS, ...o.colors },
    fonts: { ...FONT_TOKENS, ...o.fonts },
    sizes: { ...SIZE_TOKENS, ...o.sizes },
  };
}

/** A `:root { … }` block with only the profile's overrides; empty string when there are none. */
export function themeCss(profile?: ProfileLike): string {
  const o = overrides(profile);
  const lines: string[] = [];
  for (const [name, value] of Object.entries(o.colors)) {
    lines.push(`  ${cssVar("color", name)}: ${value};`);
  }
  for (const [name, value] of Object.entries(o.fonts) as [FontToken, string][]) {
    lines.push(`  ${cssVar("font", name)}: "${value}", ${FONT_STACKS[name]};`);
  }
  for (const [name, value] of Object.entries(o.sizes)) {
    lines.push(`  ${cssVar("size", name)}: ${value};`);
  }
  return lines.length === 0 ? "" : `:root {\n${lines.join("\n")}\n}`;
}

/**
 * The theme block as a `<style>` element, or "" without overrides. With a CSP of
 * `style-src 'nonce-…'` (contracts/theming.md) the element needs the response's nonce; it is
 * checked because it lands in an attribute and a bad one would also be a useless CSP.
 */
export function themeStyle(profile?: ProfileLike, nonce?: string): string {
  if (nonce !== undefined && !NONCE.test(nonce)) {
    throw new Error("nonce must be at least 16 base64 characters");
  }
  const css = themeCss(profile); // only validated token values; safe inside <style>
  if (css === "") return "";
  return `<style${nonce === undefined ? "" : ` nonce="${nonce}"`}>\n${css}\n</style>\n`;
}

/** The main logo's asset path (`logos.main`), relative to the event folder. */
export function logoPath(profile?: ProfileLike): string | undefined {
  const main = profile?.logos?.["main"];
  return typeof main === "string" && main !== "" ? main : undefined;
}
