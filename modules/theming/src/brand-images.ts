/**
 * The images a revision makes of its logo at publish (contracts/theming.md, Reading the current
 * theme): `logo_png_url`, a PNG 512 px wide for Discord and other places that take no SVG, and
 * `icon_urls`, the phone hub's icons (192 and 512 px, and a maskable 512 px on `background`), from
 * `images.icon` or else the logo. A logo with a plate (`brand.logo_plate`) is drawn on it, in both.
 */
import type { SqlClient } from "@canccu/kit";
import type { Manifest } from "./checks.js";
import { extOf } from "./files.js";
import type { FileStore } from "./files.js";
import { PLATE_PADDING, plateColor, plateOf } from "./logo-plate.js";
import { platedIcon, platedLogo, radiusShare } from "./plate-render.js";
import type { Plating } from "./plate-render.js";
import { render } from "./raster.js";
import type { Fit } from "./raster.js";
import type { Tokens } from "./tokens.js";

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
/** The safe circle itself (80 % of 512): a circle plate may fill it, a square one only its square. */
const MASKABLE_CIRCLE = 408;

/** How far across the plate of an icon is: the whole icon, or the maskable icon's safe zone. */
function plateSide(fit: { size: number; inner: number }, on: Plating): number {
  if (fit.inner === fit.size) return fit.size;
  return on.shape === "circle" ? MASKABLE_CIRCLE : fit.inner;
}

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
  tokens: Tokens,
): Promise<BrandImages> {
  const background = tokens.colors.background ?? "#000000";
  const images = (manifest.images ?? {}) as Record<string, unknown>;
  const logo = await fileAt(c, owner, images.logo);
  const ownIcon = await fileAt(c, owner, images.icon);
  const icon = ownIcon ?? logo;
  const plate = plateOf(manifest);
  const plating: Plating | undefined = plate && {
    color: plateColor(plate, tokens.colors.surface ?? "#000000").slice(0, 7),
    shape: plate.shape,
    padding: PLATE_PADDING[plate.padding],
    radius: radiusShare(tokens.sizes.radius),
  };
  // The plate belongs to the logo: an icon of its own is drawn as it is.
  const iconPlating = ownIcon === undefined ? plating : undefined;
  const read = new Map<string, Promise<Buffer | undefined>>();
  const make = async (
    name: string | undefined,
    fit: Fit,
    on: Plating | undefined,
  ): Promise<string | null> => {
    if (name === undefined) return null;
    const ext = extOf(name);
    if (ext !== "png" && ext !== "jpg" && ext !== "webp" && ext !== "svg") return null;
    if (!read.has(name)) read.set(name, files.read(name));
    const bytes = await read.get(name);
    // A file the owner refers to is on the volume; without it the theme simply has no such image.
    if (bytes === undefined) return null;
    let png: Buffer;
    const kind = ext === "jpg" ? "jpeg" : ext;
    try {
      png =
        on === undefined
          ? await render(bytes, kind, fit)
          : "width" in fit
            ? await platedLogo(bytes, kind, on, fit.width)
            : await platedIcon(bytes, kind, on, {
                size: fit.size,
                side: plateSide(fit, on),
                ...(fit.background === undefined ? {} : { background: fit.background }),
              });
    } catch {
      // Passing the upload checks does not make every image drawable at every size (an SVG a
      // pixel thin and thousands long); such an image is left out rather than failing the publish.
      return null;
    }
    return files.put(c, png, "png");
  };
  return {
    logo: logo ?? null,
    logo_png: await make(logo, { width: 512 }, plating),
    icon_192: await make(icon, { size: 192, inner: 192 }, iconPlating),
    icon_512: await make(icon, { size: 512, inner: 512 }, iconPlating),
    // Opaque, as launchers that mask the icon expect; the alpha of `background` is dropped.
    icon_maskable_512: await make(
      icon,
      { size: 512, inner: MASKABLE_INNER, background: background.slice(0, 7) },
      iconPlating,
    ),
  };
}
