/**
 * The presets of the Theme studio's Pick a look (plan issue-784 D9–D11): the demo theme packages
 * the image holds at `events/demo/themes/` (the starting points, D10), each with its colour
 * schemes. Read and checked once at start: a preset that fails the schema stops the module, as a
 * broken font pair does, rather than offering a look that cannot be applied.
 */
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { generateColors } from "./brand.js";
import type { Brand, Colors } from "./brand.js";
import { isObject } from "./checks.js";
import type { Manifest } from "./checks.js";
import { parseManifest } from "./manifest.js";
import { schemaErrors } from "./schema.js";

export const THEMES_DIR = fileURLToPath(new URL("../../../events/demo/themes/", import.meta.url));
/** The gallery's order. The Themes step (#785) adds its presets here and to the folder. */
export const PRESET_IDS = ["default", "esports", "level-up", "arcade", "terminal"] as const;

export interface Scheme {
  id: string;
  name: string;
  kind: "dark" | "light" | "contrast" | "accent";
  brand: Pick<Brand, "primary" | "accent" | "scheme">;
  colors?: Colors;
}

export interface Preset {
  id: string;
  name: string;
  description: string | undefined;
  dir: string;
  manifest: Manifest;
  schemes: Scheme[];
  /** Applying it changes the embeds, which needs `theming.embeds.write` as a package upload does. */
  embeds: boolean;
}

/** A scheme's whole colour-token set: its own, or generated from its brand as the simple mode does. */
export const schemeColors = (scheme: Scheme): Colors =>
  scheme.colors ?? generateColors({ ...scheme.brand }).colors;

function loadPreset(id: string): Preset {
  const dir = join(THEMES_DIR, id);
  const parsed = parseManifest(readFileSync(join(dir, "theme.yaml")));
  if (!parsed.ok) throw new Error(`preset ${id}: ${parsed.why}`);
  const errors = schemaErrors(parsed.manifest);
  if (errors.length > 0) throw new Error(`preset ${id}: ${errors[0]?.message}`);
  const m = parsed.manifest;
  const schemes = Array.isArray(m.schemes) ? (m.schemes as Scheme[]) : [];
  if (schemes.length === 0) throw new Error(`preset ${id}: no schemes`);
  return {
    id,
    name: String(m.name),
    description: typeof m.description === "string" ? m.description : undefined,
    dir,
    manifest: m,
    schemes,
    embeds: isObject(m.embeds) && Object.keys(m.embeds).length > 0,
  };
}

export const PRESETS: ReadonlyMap<string, Preset> = new Map(
  PRESET_IDS.map((id) => [id, loadPreset(id)]),
);

/** A preset's files by package path, `theme.yaml` among them, as a package upload reads a zip. */
export async function presetFiles(preset: Preset): Promise<Map<string, Buffer>> {
  const entries = await readdir(preset.dir, { recursive: true, withFileTypes: true });
  const out = new Map<string, Buffer>();
  for (const e of entries.filter((x) => x.isFile())) {
    const full = join(e.parentPath, e.name);
    out.set(relative(preset.dir, full), await readFile(full));
  }
  return out;
}

/** What applying a preset keeps of the event's draft (D11): its pictures, plate and Discord colour. */
export interface Kept {
  images: Partial<Record<"logo" | "icon", string>>;
  brand: Partial<Pick<Brand, "logo_plate" | "embed_color">>;
}

/** The preset's manifest under one of its schemes, with what the event keeps over it. */
export function presetManifest(preset: Preset, scheme: Scheme, kept: Kept): Manifest {
  const m = structuredClone(preset.manifest);
  const tokens = isObject(m.tokens) ? m.tokens : {};
  m.tokens = { ...tokens, colors: schemeColors(scheme) };
  // Over the package's own brand, not a rebuilt one: its font pair, corners and backdrop stay (#823).
  m.brand = { ...(isObject(m.brand) ? m.brand : {}), ...scheme.brand, ...kept.brand };
  const images = { ...(isObject(m.images) ? m.images : {}), ...kept.images };
  if (Object.keys(images).length > 0) m.images = images;
  m.preset = { id: preset.id, scheme: scheme.id };
  return m;
}

/** A saved preset's manifest (D18) with what the event keeps over it; Reset returns to it. */
export function mineManifest(saved: Manifest, id: string, kept: Kept): Manifest {
  const m = structuredClone(saved);
  m.brand = { ...(isObject(m.brand) ? m.brand : {}), ...kept.brand };
  const images = { ...(isObject(m.images) ? m.images : {}), ...kept.images };
  if (Object.keys(images).length > 0) m.images = images;
  // Its colours are its own, so it has no scheme to choose: `own` fills the field the schema needs.
  m.preset = { id, scheme: "own" };
  return m;
}
