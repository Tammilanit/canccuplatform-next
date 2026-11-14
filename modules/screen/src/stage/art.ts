/**
 * A game's art for the stage and the cards (contracts/screen.md, The stage, Game art): the cover
 * read once as a guest reads it, blurred once here, and kept in Valkey. A cache, never state: what
 * is gone is made again, and nothing of it counts against the storage quota. Covers that cannot
 * be read are kept as a failure for 10 minutes, so a broken cover is not fetched every compose.
 */
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { tenantKey } from "@canccu/kit";
import sharp from "sharp";
import { sniff } from "../assets/sniff.js";
import type { Kv } from "../kv.js";
import type { Extremes, Rgb } from "./scrim.js";

export const ART_WIDTH = 640;
export const ART_SIGMA = 20;
const ART_TTL_MS = 30 * 24 * 3600_000;
const FAILED_TTL_MS = 10 * 60_000;
/** The cover is one image a guest's browser loads; anything larger is no cover. */
const MAX_COVER_BYTES = 8 * 1024 * 1024;
/**
 * The whole read, not only a quiet socket: a cover that trickles in would otherwise hold the
 * compose, and every screen's state with it.
 */
const READ_DEADLINE_MS = 3000;
/**
 * sharp's default (~268 Mpx) would decode a huge picture in full on the compose path; a cover is
 * shown at 640 px, so 40 Mpx is far more than any real one.
 */
const MAX_COVER_PIXELS = 40_000_000;
/** The formats every screen's browser shows; GIF and the rest are no covers. */
const COVER_TYPES = new Set(["png", "jpg", "webp"]);
const SAMPLE = 32;

/** What compose needs of a cover: the blurred art's id and both images' extremes. */
export interface ArtInfo {
  id: string;
  art: Extremes;
  cover: Extremes;
}

/** Reads a path on the event's hostname as a guest would; null for anything but a 200. */
export type ReadCover = (hostname: string, path: string) => Promise<Buffer | null>;

const coverKey = (url: string) =>
  tenantKey("screen", "art", "cover", createHash("sha256").update(url).digest("hex"));
const bytesKey = (id: string) => tenantKey("screen", "art", "bytes", id);

/**
 * A cover URL Screen may read: a path on the event's hostname, never a scheme, another host
 * (`//host`) or a backslash a proxy might read as one.
 */
export function coverPath(url: unknown): string | null {
  if (typeof url !== "string" || url.length > 2048) return null;
  if (!url.startsWith("/") || url.startsWith("//") || url.includes("\\")) return null;
  // Printable ASCII only: the path goes on the request line as it is.
  return /^[\x21-\x7e]+$/.test(url) ? url : null;
}

/** By content, as the screen's uploads are judged (assets/sniff.ts). */
function isCoverImage(b: Buffer): boolean {
  const kind = sniff(b.subarray(0, 4096), b.subarray(-64 * 1024));
  return kind?.kind === "image" && COVER_TYPES.has(kind.ext);
}

const decode = (b: Buffer) => sharp(b, { limitInputPixels: MAX_COVER_PIXELS });

/** The lightest and darkest pixel of a 32 px version, by luminance. */
async function extremesOf(image: Buffer): Promise<Extremes> {
  const { data, info } = await decode(image)
    .resize(SAMPLE, SAMPLE, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let light: Rgb = [0, 0, 0];
  let dark: Rgb = [255, 255, 255];
  const lum = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  for (let i = 0; i + 2 < data.length; i += info.channels) {
    const px: Rgb = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
    if (lum(px) > lum(light)) light = px;
    if (lum(px) < lum(dark)) dark = px;
  }
  return { light, dark };
}

/** The blurred art: 640 px wide (never enlarged past it), Gaussian sigma 20, WebP. */
export async function blurCover(cover: Buffer): Promise<{ webp: Buffer } & ArtInfo> {
  const webp = await decode(cover)
    .rotate()
    .resize({ width: ART_WIDTH })
    .blur(ART_SIGMA)
    .webp({ quality: 70 })
    .toBuffer();
  const [art, coverExtremes] = await Promise.all([extremesOf(webp), extremesOf(cover)]);
  return {
    webp,
    id: createHash("sha256").update(webp).digest("hex"),
    art,
    cover: coverExtremes,
  };
}

/** One GET through the edge (Caddy) with the event's hostname, as a guest's browser sends it. */
export function edgeReader(edgeUrl: string, deadlineMs = READ_DEADLINE_MS): ReadCover {
  return (hostname, path) =>
    new Promise((resolve) => {
      const done = (bytes: Buffer | null): void => {
        clearTimeout(deadline);
        resolve(bytes);
      };
      const req = httpRequest(
        new URL(path, edgeUrl),
        { headers: { host: hostname, accept: "image/*" } },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_COVER_BYTES) req.destroy(new Error("cover too large"));
            else chunks.push(chunk);
          });
          res.on("end", () => {
            done(res.statusCode === 200 ? Buffer.concat(chunks) : null);
          });
          res.on("error", () => {
            done(null);
          });
        },
      );
      const deadline = setTimeout(() => {
        req.destroy(new Error("deadline"));
        done(null);
      }, deadlineMs);
      req.on("error", () => {
        done(null);
      });
      req.end();
    });
}

export class ArtCache {
  /**
   * Reads under way, by their tenant's cover key: zones of one event compose at once, and each
   * would otherwise read and blur the same uncached cover.
   */
  private readonly inFlight = new Map<string, Promise<ArtInfo | null>>();

  constructor(
    private readonly kv: Kv,
    private readonly read: ReadCover,
  ) {}

  /** The cover's art in the current tenant, made on first use; null when it cannot be read. */
  async of(hostname: string, url: unknown): Promise<ArtInfo | null> {
    const path = coverPath(url);
    if (path === null) return null;
    const key = coverKey(path);
    const running = this.inFlight.get(key);
    if (running !== undefined) return running;
    const made = this.lookup(hostname, path, key).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, made);
    return made;
  }

  private async lookup(hostname: string, path: string, key: string): Promise<ArtInfo | null> {
    const kept = await this.kv.get(key).catch(() => null);
    if (kept !== null) {
      const info = JSON.parse(kept) as ArtInfo | { failed: true };
      // The bytes may have gone before the entry (an eviction): then the art is made again.
      if ("failed" in info) return null;
      if ((await this.kv.get(bytesKey(info.id)).catch(() => null)) !== null) return info;
    }
    const made = await this.make(hostname, path);
    if (made === null) {
      await this.kv
        .set(key, JSON.stringify({ failed: true }), FAILED_TTL_MS)
        .catch(() => undefined);
      return null;
    }
    const { webp, ...info } = made;
    await this.kv.set(bytesKey(info.id), webp.toString("base64"), ART_TTL_MS);
    await this.kv.set(key, JSON.stringify(info), ART_TTL_MS);
    return info;
  }

  /** The blurred art's bytes by id, in the current tenant only; null once the cache lost them. */
  async bytes(id: string): Promise<Buffer | null> {
    const kept = await this.kv.get(bytesKey(id));
    return kept === null ? null : Buffer.from(kept, "base64");
  }

  private async make(hostname: string, path: string): Promise<(ArtInfo & { webp: Buffer }) | null> {
    const cover = await this.read(hostname, path);
    if (cover === null || !isCoverImage(cover)) return null;
    try {
      return await blurCover(cover);
    } catch {
      return null;
    }
  }
}
