/**
 * What one `PUT …/draft/brand` makes of the stored theme (contracts/theming.md, Brand kit): the
 * whole merge in one pure function, so test/brand-save.test.ts can hold every stored field to "a
 * save that leaves it out keeps it, a save that names it changes only it". Five merged PRs each
 * lost or replaced a stored field while this merge was spread over the route (recurring finding
 * #843); the route now only checks the body and the draft's files around it.
 */
import { generateColors } from "./brand.js";
import type { Brand } from "./brand.js";
import { nextBrand } from "./brand-edit.js";
import { isObject } from "./checks.js";
import type { Manifest } from "./checks.js";
import { minBoxOpacity } from "./contrast.js";
import type { BrandEdit } from "./schema.js";
import { fillTokens } from "./tokens.js";

/** The colours generated from `brand`, with the theme's other tokens kept. */
export function withColors(manifest: Manifest, brand: Brand): Manifest {
  const tokens = isObject(manifest.tokens) ? manifest.tokens : {};
  return { ...manifest, tokens: { ...tokens, colors: generateColors(brand).colors } };
}

/**
 * A pair or corners the organiser picks now must show: a preset's own font and radius tokens sit
 * over the brand's choices (tokens.ts), so they go when a different choice is made (the mirror of
 * draft-routes.ts, where a token edit takes the choice away).
 */
function withoutOverriddenChoices(
  manifest: Manifest,
  before: Record<string, unknown>,
  input: BrandEdit,
): Manifest {
  if (!isObject(manifest.tokens)) return manifest;
  const tokens = { ...manifest.tokens };
  const without = (group: unknown, keys: string[]): Record<string, unknown> | undefined => {
    if (!isObject(group)) return undefined;
    const rest = Object.fromEntries(Object.entries(group).filter(([k]) => !keys.includes(k)));
    return Object.keys(rest).length > 0 ? rest : undefined;
  };
  const pair = typeof input.font_pair === "string" && input.font_pair !== before.font_pair;
  if (pair) {
    const fonts = without(tokens.fonts, ["heading", "display", "body"]);
    if (fonts === undefined) delete tokens.fonts;
    else tokens.fonts = fonts;
  }
  const corners = input.roundness !== undefined && input.roundness !== before.roundness;
  if (corners) {
    const sizes = without(tokens.sizes, ["radius"]);
    if (sizes === undefined) delete tokens.sizes;
    else tokens.sizes = sizes;
  }
  return { ...manifest, tokens };
}

/**
 * A box opacity under what the colours allow is raised to it (plan issue-785 D11), so the stored
 * value is the one the screens draw (tokens.ts raises on generation too); true when it was.
 */
export function raiseBoxOpacity(manifest: Manifest): boolean {
  const brand = manifest.brand as Brand;
  if (brand.box_opacity === undefined) return false;
  // The filled set, as tokens.ts judges it: a partial `tokens.colors` must not force 1.
  const min = minBoxOpacity(fillTokens(isObject(manifest.tokens) ? manifest.tokens : {}).colors);
  if (brand.box_opacity >= min) return false;
  brand.box_opacity = min;
  return true;
}

/** The theme a save stores, and whether it raised the box opacity (`adjusted` names it then). */
export function saveBrand(m: Manifest, input: BrandEdit): { manifest: Manifest; raised: boolean } {
  const before = isObject(m.brand) ? m.brand : {};
  const brand = nextBrand(isObject(m.brand) ? m.brand : undefined, input);
  // The logo and icon are the theme's only ones, so the body names them on every save.
  const images = isObject(m.images) ? { ...m.images } : {};
  delete images.logo;
  delete images.icon;
  if (input.logo !== undefined) images.logo = input.logo;
  if (input.icon !== undefined) images.icon = input.icon;
  const next: Manifest = { ...m, brand };
  if (Object.keys(images).length > 0) next.images = images;
  else delete next.images;
  // A scheme's hand-set colours (presets.ts) stay until the organiser changes what the colours
  // come from; the page sends the whole brand on every change, the corners too.
  const tokens = isObject(m.tokens) ? m.tokens : {};
  const same = (["primary", "accent", "scheme"] as const).every((k) => before[k] === brand[k]);
  const colored = same && isObject(tokens.colors) ? next : withColors(next, brand);
  const raised = raiseBoxOpacity(colored);
  return { manifest: withoutOverriddenChoices(colored, before, input), raised };
}
