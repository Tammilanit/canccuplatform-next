/**
 * The logo's backdrop plate (plan issue-784 D4, D5): its values, the custom properties every
 * surface draws it with, and the check that finds a logo lost on the theme's grounds and suggests
 * the plate that brings it back. A black logo on a transparent ground vanishes on a dark scheme.
 */
import sharp from "sharp";
import type { Manifest, Problem } from "./checks.js";
import { isObject } from "./checks.js";
import { contrastRatio } from "./contrast.js";
import { render } from "./raster.js";
import type { RasterKind } from "./raster.js";

export type PlateKind = "light" | "dark" | "surface";

export interface LogoPlate {
  kind: "none" | PlateKind;
  shape: "rounded" | "circle";
  padding: "small" | "medium" | "large";
}

export const PLATE_COLORS = { light: "#f7f7f8", dark: "#121317" } as const;
/** The padding as a share of the logo's drawn height, so a plate looks the same at every size. */
export const PLATE_PADDING = { small: 0.08, medium: 0.15, large: 0.25 } as const;

/** A plate that is drawn: any kind but `none`. */
export type Plate = LogoPlate & { kind: PlateKind };

/** The plate of a manifest's brand, or undefined for none (or a plate a newer platform made). */
export function plateOf(manifest: Manifest): Plate | undefined {
  const plate = isObject(manifest.brand) ? manifest.brand.logo_plate : undefined;
  if (!isObject(plate) || plate.kind === "none") return undefined;
  if (plate.kind !== "light" && plate.kind !== "dark" && plate.kind !== "surface") return undefined;
  const shape = plate.shape === "circle" ? "circle" : "rounded";
  const padding = Object.hasOwn(PLATE_PADDING, String(plate.padding))
    ? (plate.padding as LogoPlate["padding"])
    : "medium";
  return { kind: plate.kind, shape, padding };
}

/** The plate's colour as a hex value, the surface plate in the theme's own `surface`. */
export const plateColor = (plate: Plate, surface: string): string =>
  plate.kind === "surface" ? surface : PLATE_COLORS[plate.kind];

/**
 * The custom properties of contracts/theming.md (Stable classes and custom properties): each
 * surface's logo rule works its padding out from its own logo height and this factor.
 */
export function plateVars(plate: LogoPlate | undefined): string[] {
  if (plate === undefined || plate.kind === "none") return [];
  const color = plate.kind === "surface" ? "var(--canccu-color-surface)" : PLATE_COLORS[plate.kind];
  return [
    `  --canccu-logo-plate: ${color};`,
    `  --canccu-logo-plate-radius: ${plate.shape === "circle" ? "50%" : "var(--canccu-radius)"};`,
    `  --canccu-logo-plate-padding: ${PLATE_PADDING[plate.padding]};`,
    // A circle is square around the logo, which keeps its proportions inside (object-fit).
    ...(plate.shape === "circle" ? ["  --canccu-logo-plate-aspect: 1;"] : []),
  ];
}

export interface Rgba {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface PlateAdvice {
  shows: { background: boolean; surface: boolean };
  suggest: PlateKind | null;
}

/** A pixel counts once it covers at least half of what lies under it. */
const OPAQUE = 128;
/** A box this opaque draws its own ground around the mark: it shows on any background. */
const OWN_GROUND = 0.98;
/**
 * Below this share of the box, too little of the logo is drawn to be seen at all: no ground
 * counts as showing it, however its few pixels contrast (Review focus 1, a 1-px ring).
 */
const VISIBLE = 0.01;
const SHOWS = 0.5;
const PLATE_FIT = 0.8;
const NEEDED = 3;

const hex2 = (n: number): string => n.toString(16).padStart(2, "0");

/**
 * Whether the logo shows on the theme's `background` (the screen) and `surface` (the hub and the
 * shell), and, when either hides it, the plate most of it reads on.
 */
export function plateAdvice(
  rgba: Rgba,
  grounds: { background: string; surface: string },
): PlateAdvice {
  const colours: string[] = [];
  let luminance = 0;
  const { data } = rgba;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < OPAQUE) continue;
    const [r, g, b] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
    colours.push(`#${hex2(r)}${hex2(g)}${hex2(b)}`);
    luminance += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  const box = rgba.width * rgba.height;
  if (box > 0 && colours.length / box >= OWN_GROUND) {
    return { shows: { background: true, surface: true }, suggest: null };
  }
  const visible = box > 0 && colours.length / box >= VISIBLE;
  // Many pixels share a colour (a flat logo has a handful), so each colour is measured once.
  const counts = new Map<string, number>();
  for (const c of colours) counts.set(c, (counts.get(c) ?? 0) + 1);
  const share = (ground: string): number => {
    if (!visible) return 0;
    let reading = 0;
    for (const [c, n] of counts) if (contrastRatio(c, ground) >= NEEDED) reading += n;
    return reading / colours.length;
  };
  const shows = {
    background: share(grounds.background) >= SHOWS,
    surface: share(grounds.surface) >= SHOWS,
  };
  if (shows.background && shows.surface) return { shows, suggest: null };
  const plates: [PlateKind, string][] = [
    ["light", PLATE_COLORS.light],
    ["dark", PLATE_COLORS.dark],
    ["surface", grounds.surface],
  ];
  const fit = plates.find(([, colour]) => share(colour) >= PLATE_FIT)?.[0];
  const dark = colours.length === 0 || luminance / colours.length < 0.5;
  return { shows, suggest: fit ?? (dark ? "light" : "dark") };
}

const SIDE = 128;

/** The logo drawn at most 128 px wide, its pixels with their alpha: SVG drawn sharp, not scaled up. */
export async function rasterLogo(bytes: Buffer, ext: RasterKind | "svg"): Promise<Rgba> {
  const png = await render(bytes, ext, { width: SIDE });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

const CACHED = 256;
const cache = new Map<string, PlateAdvice>();

export const kindOf = (name: string): RasterKind | "svg" | undefined => {
  const ext = name.slice(name.lastIndexOf(".") + 1);
  if (ext === "jpg") return "jpeg";
  return ext === "png" || ext === "webp" || ext === "svg" ? ext : undefined;
};

/**
 * plateAdvice for a stored logo, kept by its file name (its content's hash) and the grounds, so
 * the checks every draft change re-runs draw a logo once. Undefined for a logo that is gone or
 * cannot be drawn: the upload checks already speak for such a file.
 */
export async function logoAdvice(
  read: (name: string) => Promise<Buffer | undefined>,
  name: string,
  grounds: { background: string; surface: string },
): Promise<PlateAdvice | undefined> {
  const key = `${name}|${grounds.background}|${grounds.surface}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const kind = kindOf(name);
  const bytes = kind === undefined ? undefined : await read(name);
  if (kind === undefined || bytes === undefined) return undefined;
  let advice: PlateAdvice;
  try {
    advice = plateAdvice(await rasterLogo(bytes, kind), grounds);
  } catch {
    return undefined;
  }
  if (cache.size >= CACHED) cache.delete(cache.keys().next().value as string);
  cache.set(key, advice);
  return advice;
}

const GROUND_WORDS = { background: "the screen's background", surface: "the pages' cards" };

/**
 * `logo_unreadable` (a warning): the logo hides on a ground and no plate is set. With a plate the
 * plate is its ground, so there is nothing to warn about.
 */
export function logoProblems(
  manifest: Manifest,
  path: string,
  advice: PlateAdvice | undefined,
): Problem[] {
  if (advice === undefined || advice.suggest === null || plateOf(manifest) !== undefined) return [];
  const hidden = (["background", "surface"] as const).filter((g) => !advice.shows[g]);
  if (hidden.length === 0) return [];
  const plate =
    advice.suggest === "surface"
      ? "a plate in the theme's surface colour"
      : `a ${advice.suggest} plate`;
  return [
    {
      severity: "warning",
      code: "logo_unreadable",
      path,
      message: `The logo is hard to see on ${hidden.map((g) => GROUND_WORDS[g]).join(" and ")}. Put it on ${plate}.`,
    },
  ];
}
