/** Ported from the legacy `image-resize` and `image-orientation` tests, to the contract's frame. */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { fitSize, normalizeImage as normalizeStream } from "../src/assets/image.js";

/** The stored bytes, as `receive` would write them. */
async function normalizeImage(input: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await normalizeStream(input)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Left half red, right half blue, so the direction of a turn shows. */
async function jpeg(width: number, height: number, orientation?: number): Promise<Buffer> {
  const left = await sharp({
    create: { width: Math.floor(width / 2), height, channels: 3, background: "#ff0000" },
  })
    .png()
    .toBuffer();
  let pipeline = sharp({ create: { width, height, channels: 3, background: "#0000ff" } })
    .composite([{ input: left, left: 0, top: 0 }])
    .jpeg({ quality: 90 });
  pipeline = pipeline.withMetadata({
    ...(orientation ? { orientation } : {}),
    exif: { IFD0: { Copyright: "someone", Artist: "a phone" } },
  });
  return pipeline.toBuffer();
}

async function pixel(bytes: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [...data.subarray(i, i + 3)];
}

const isRed = ([r = 0, , b = 0]: number[]) => r > 200 && b < 60;
const isBlue = ([r = 0, , b = 0]: number[]) => b > 200 && r < 60;

describe("fitSize", () => {
  it("fits inside 2560×1440 and never enlarges", () => {
    expect(fitSize(4608, 3072)).toEqual({ width: 2160, height: 1440 });
    expect(fitSize(3072, 4608)).toEqual({ width: 960, height: 1440 });
    expect(fitSize(5120, 1000)).toEqual({ width: 2560, height: 500 });
    expect(fitSize(2560, 1440)).toBeNull();
    expect(fitSize(1920, 1080)).toBeNull();
  });
});

describe("normalizeImage", () => {
  it("drops metadata and keeps the format and size of a small upright image", async () => {
    const input = await jpeg(64, 32);
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await normalizeImage(input);
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 64, height: 32 });
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it("bakes orientation 6 into the pixels: the red half ends on top", async () => {
    const out = await normalizeImage(await jpeg(64, 32, 6));
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ width: 32, height: 64 });
    expect(meta.orientation).toBeUndefined();
    expect(isRed(await pixel(out, 16, 8))).toBe(true);
    expect(isBlue(await pixel(out, 16, 56))).toBe(true);
  });

  it("scales a huge photo into the frame, turned first", async () => {
    const wide = await sharp(await normalizeImage(await jpeg(4000, 2000))).metadata();
    expect(wide).toMatchObject({ width: 2560, height: 1280 });
    const portrait = await sharp(await normalizeImage(await jpeg(3000, 2000, 6))).metadata();
    expect(portrait).toMatchObject({ width: 960, height: 1440 });
  });

  it("keeps an animated GIF animated", async () => {
    const frame = (background: string) =>
      sharp({ create: { width: 8, height: 8, channels: 3, background } })
        .png()
        .toBuffer();
    const gif = await sharp([await frame("#ff0000"), await frame("#0000ff")], {
      join: { animated: true },
    })
      .gif()
      .toBuffer();
    const meta = await sharp(await normalizeImage(gif), { animated: true }).metadata();
    expect(meta).toMatchObject({ format: "gif", pages: 2, width: 8, pageHeight: 8 });
  });

  it("keeps an animation's frame size whatever orientation it claims", async () => {
    const frame = (background: string) =>
      sharp({ create: { width: 16, height: 8, channels: 3, background } })
        .png()
        .toBuffer();
    const gif = await sharp([await frame("#ff0000"), await frame("#0000ff")], {
      join: { animated: true },
    })
      .gif()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const meta = await sharp(await normalizeImage(gif), { animated: true }).metadata();
    expect(meta).toMatchObject({ width: 16, pageHeight: 8 });
  });

  it("refuses bytes that only look like an image", async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
    await expect(normalizeImage(fake)).rejects.toMatchObject({
      status: 400,
      code: "invalid_request",
    });
  });
});
