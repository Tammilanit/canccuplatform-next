/** Photos for the receipt and reader tests, made in memory. */
import sharp from "sharp";

/** A phone photo: a JPEG that carries a location (EXIF GPS), as a camera writes it. */
export function photoWithLocation(width = 1200, height = 1600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#f4f1ea" } })
    .jpeg()
    .withExif({
      IFD0: { Make: "Demo Phone" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "60/1 10/1 0/1" },
    })
    .toBuffer();
}

export function png(width = 400, height = 300): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .png()
    .toBuffer();
}

export function webp(width = 400, height = 300): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .webp()
    .toBuffer();
}

/** A plain photo of `width` × `height`, as a camera would take one held upright. */
export function tallJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#f4f1ea" } })
    .jpeg()
    .toBuffer();
}

/**
 * A valid JPEG of exactly `bytes`: a 4000 × 3000 photo padded with comment segments right after
 * its start, as a phone's large photo is big without being slow to decode in a test.
 */
export async function bigJpeg(bytes: number, width = 4000, height = 3000): Promise<Buffer> {
  const photo = await tallJpeg(width, height);
  return padded(
    photo,
    2,
    bytes,
    (n) => {
      const seg = Buffer.alloc(n);
      seg.writeUInt16BE(0xfffe, 0);
      seg.writeUInt16BE(n - 2, 2);
      return seg;
    },
    65_000,
  );
}

/** A valid PNG of exactly `bytes`, padded with text chunks after its header. */
export async function bigPng(bytes: number, width = 4000, height = 3000): Promise<Buffer> {
  const photo = await sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .png()
    .toBuffer();
  // The signature (8) and the IHDR chunk (25) come first; the readers skip unknown text chunks.
  return padded(
    photo,
    33,
    bytes,
    (n) => {
      const chunk = Buffer.alloc(n, 0x61);
      chunk.writeUInt32BE(n - 12, 0);
      chunk.write("tEXt", 4, "latin1");
      chunk.write("pad\0", 8, "latin1");
      chunk.writeUInt32BE(crc32(chunk.subarray(4, n - 4)), n - 4);
      return chunk;
    },
    1_000_000,
  );
}

function padded(
  photo: Buffer,
  at: number,
  bytes: number,
  piece: (n: number) => Buffer,
  most: number,
): Buffer {
  const pieces: Buffer[] = [];
  let left = bytes - photo.length;
  if (left < 0) throw new Error(`the photo alone is ${photo.length} bytes`);
  while (left > 0) {
    // Never leave a remainder too small to be a piece of its own.
    const n = left <= most ? left : Math.min(most, left - 64);
    pieces.push(piece(n));
    left -= n;
  }
  return Buffer.concat([photo.subarray(0, at), ...pieces, photo.subarray(at)]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = (CRC_TABLE[(c ^ x) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
