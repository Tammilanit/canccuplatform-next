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
