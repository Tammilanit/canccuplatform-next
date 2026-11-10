/**
 * The images a revision makes of its logo at publish (contracts/theming.md, Reading the current
 * theme): `logo_png_url`, a PNG 512 px wide for Discord and other places that take no SVG, and
 * `icon_urls`, the phone hub's icons (192 and 512 px, and a maskable 512 px on `background`), from
 * `images.icon` or else the logo.
 */
import type { SqlClient } from "@canccu/kit";
import type { Manifest } from "./checks.js";
import { extOf } from "./files.js";
import type { FileStore } from "./files.js";
import { render } from "./raster.js";
import type { Fit } from "./raster.js";

export interface BrandImages {
  logo: string | null;
  logo_png: string | null;
  icon_192: string | null;
  icon_512: string | null;
  icon_maskable_512: string | null;
}

export const NO_IMAGES: BrandImages = {
  logo: null,
  logo_png: null,
  icon_192: null,
  icon_512: null,
  icon_maskable_512: null,
};

/**
 * A maskable icon may be cut to a circle of 40 % of its size around the centre; the largest
 * square inside it is about 290 px of 512, so the logo keeps to 288 px there.
 */
const MASKABLE_INNER = 288;

/** The stored file at the owner's package `path`, when it holds one. */
async function fileAt(c: SqlClient, owner: string, path: unknown): Promise<string | undefined> {
  if (typeof path !== "string") return undefined;
  const { rows } = await c.query(
    `SELECT file FROM theming_package_files WHERE owner = $1 AND path = $2 AND file IS NOT NULL`,
    [owner, path],
  );
  return (rows[0] as { file: string } | undefined)?.file;
}

/**
 * Makes and stores the images of `manifest`, whose files `owner` holds. The same image and
 * background give the same bytes, so a republish or restore names the same files again.
 */
export async function brandImages(
  c: SqlClient,
  files: FileStore,
  owner: string,
  manifest: Manifest,
  background: string,
): Promise<BrandImages> {
  const images = (manifest.images ?? {}) as Record<string, unknown>;
  const logo = await fileAt(c, owner, images.logo);
  const icon = (await fileAt(c, owner, images.icon)) ?? logo;
  const make = async (name: string | undefined, fit: Fit): Promise<string | null> => {
    if (name === undefined) return null;
    const bytes = await files.read(name);
    // A file the owner refers to is on the volume; without it the theme simply has no such image.
    if (bytes === undefined) return null;
    const ext = extOf(name);
    if (ext !== "png" && ext !== "jpg" && ext !== "webp" && ext !== "svg") return null;
    const png = await render(bytes, ext === "jpg" ? "jpeg" : ext, fit);
    return files.put(c, png, "png");
  };
  return {
    logo: logo ?? null,
    logo_png: await make(logo, { width: 512 }),
    icon_192: await make(icon, { size: 192, inner: 192 }),
    icon_512: await make(icon, { size: 512, inner: 512 }),
    // Opaque, as launchers that mask the icon expect; the alpha of `background` is dropped.
    icon_maskable_512: await make(icon, {
      size: 512,
      inner: MASKABLE_INNER,
      background: background.slice(0, 7),
    }),
  };
}
