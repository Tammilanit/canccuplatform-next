/**
 * Content checks and the video and sound probe against real files, with the real ffprobe. Ported
 * from the legacy `asset-upload`, `video-duration`, `video-real-length` and `audio-duration`
 * tests: the length now comes from ffprobe (plan #108, D8), and the codecs are checked too.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KitError } from "@canccu/kit";
import { ffprobe, judgeMedia } from "../src/assets/probe.js";
import { sniff } from "../src/assets/sniff.js";
import type { Sniffed } from "../src/assets/sniff.js";

const fixture = (name: string): string =>
  new URL(`./fixtures/media/${name}`, import.meta.url).pathname;
const probe = ffprobe();

function sniffFile(name: string): ReturnType<typeof sniff> {
  const bytes = readFileSync(fixture(name));
  return sniff(bytes.subarray(0, 4096), bytes.subarray(-65536));
}

async function judge(name: string): Promise<{ duration_seconds: number | null }> {
  const sniffed = sniffFile(name);
  if (sniffed === null) throw new Error(`${name} not recognised`);
  if (sniffed.kind === "unplayable-image" || sniffed.demuxer === undefined) {
    throw new Error(`${name} is no media`);
  }
  return judgeMedia(
    sniffed,
    await probe(fixture(name), sniffed.demuxer),
    readFileSync(fixture(name)).length,
  );
}

async function refusal(name: string): Promise<{ status: number; code: string; message: string }> {
  try {
    await judge(name);
  } catch (err) {
    if (err instanceof KitError)
      return { status: err.status, code: err.code, message: err.message };
    throw err;
  }
  throw new Error(`${name} was accepted`);
}

describe("sniff", () => {
  const bytes = (...parts: (string | number[])[]): Buffer =>
    Buffer.concat(
      parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))),
    );

  it("reads images by their signature, never by name", () => {
    expect(sniff(bytes([0x89], "PNG\r\n\x1a\n", "rest"), Buffer.alloc(0))).toMatchObject({
      kind: "image",
      ext: "png",
      mime: "image/png",
    });
    expect(sniff(bytes([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(0))?.kind).toBe("image");
    expect(sniff(bytes("GIF89a"), Buffer.alloc(0))).toMatchObject({ ext: "gif" });
    expect(sniff(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "), Buffer.alloc(0))).toMatchObject({
      ext: "webp",
    });
  });

  it("refuses what the screens never show: html, svg, scripts, empty and tiny files", () => {
    for (const text of ["<!doctype html><svg>", "<svg xmlns=", "#!/bin/sh\n", "", "ab"]) {
      expect(sniff(bytes(text), bytes(text))).toBeNull();
    }
  });

  it("tells a deck from any zip by the presentation it names", () => {
    const zip = bytes("PK\x03\x04", "....");
    expect(sniff(zip, bytes("...ppt/presentation.xml..."))).toMatchObject({ kind: "pptx" });
    expect(sniff(zip, bytes("...word/document.xml..."))).toBeNull();
    expect(sniff(bytes("%PDF-1.7"), Buffer.alloc(0))).toMatchObject({ kind: "pdf", ext: "pdf" });
  });

  it("tells WebM from Matroska, and MP4 from QuickTime", () => {
    expect(sniffFile("clip-vp9-opus.webm")).toMatchObject({ kind: "video", ext: "webm" });
    expect(sniffFile("clip-h264.mkv")).toEqual({
      kind: "unplayable",
      container: "Matroska",
      demuxer: "matroska",
    });
    expect(sniffFile("clip-h264-aac.mp4")).toMatchObject({ kind: "video", ext: "mp4" });
    expect(sniffFile("clip-prores.mov")).toEqual({
      kind: "unplayable",
      container: "QuickTime",
      demuxer: "mov",
    });
    expect(sniffFile("sound.mp3")).toMatchObject({ kind: "audio", ext: "mp3" });
    expect(sniffFile("sound.ogg")).toMatchObject({ kind: "audio", ext: "ogg" });
    expect(sniffFile("sound.wav")).toEqual({
      kind: "unplayable",
      container: "WAV",
      demuxer: "wav",
    });
  });

  it("tells HEIC and AVIF photos from MP4 video", () => {
    const ftyp = (brand: string) => Buffer.from(`\0\0\0\x18ftyp${brand}\0\0\0\0`, "latin1");
    expect(sniff(ftyp("heic"), Buffer.alloc(0))).toEqual({
      kind: "unplayable-image",
      container: "HEIF",
    });
    expect(sniff(ftyp("mif1"), Buffer.alloc(0))).toEqual({
      kind: "unplayable-image",
      container: "HEIF",
    });
    expect(sniff(ftyp("avif"), Buffer.alloc(0))).toEqual({
      kind: "unplayable-image",
      container: "AVIF",
    });
    expect(sniff(ftyp("isom"), Buffer.alloc(0))).toMatchObject({ kind: "video", demuxer: "mov" });
  });
});

describe("judgeMedia with ffprobe", () => {
  it("reads a video's real length, with its index at the end or the start", async () => {
    expect((await judge("clip-h264-aac.mp4")).duration_seconds).toBeCloseTo(2, 1);
    expect((await judge("clip-h264-faststart.mp4")).duration_seconds).toBeCloseTo(2, 1);
    expect((await judge("clip-vp9-opus.webm")).duration_seconds).toBeCloseTo(2, 1);
  });

  it("refuses other containers and codecs, naming what was found and what to export", async () => {
    expect(await refusal("clip-prores.mov")).toEqual({
      status: 400,
      code: "media_unsupported",
      message: "This file is QuickTime with ProRes video. Export it as MP4 (H.264).",
    });
    expect((await refusal("clip-h264.mkv")).message).toBe(
      "This file is Matroska with H.264 video. Export it as MP4 (H.264).",
    );
    expect((await refusal("sound.wav")).message).toBe(
      "This file is WAV with PCM audio. Export it as MP3 or OGG.",
    );
  });

  it("refuses a codec the container allows elsewhere", () => {
    const webm: Sniffed = { kind: "video", ext: "webm", mime: "video/webm", container: "WebM" };
    const out = { streams: [{ codec_type: "video", codec_name: "h264" }] };
    expect(() => judgeMedia(webm, out, 10)).toThrow(
      "This file is WebM with H.264 video. Export it as MP4 (H.264).",
    );
    const mp4: Sniffed = { kind: "video", ext: "mp4", mime: "video/mp4", container: "MP4" };
    const audioOnly = { streams: [{ codec_type: "audio", codec_name: "aac" }] };
    expect(() => judgeMedia(mp4, audioOnly, 10)).toThrow(/no video/);
  });

  it("keeps sounds of at most 30 seconds and 2 MiB, cover art allowed", async () => {
    expect((await judge("sound.mp3")).duration_seconds).toBeCloseTo(2.16, 1);
    expect((await judge("sound.ogg")).duration_seconds).toBeCloseTo(2, 1);
    const long = await refusal("sound-long.mp3");
    expect(long).toMatchObject({ status: 400, code: "invalid_request" });
    expect(long.message).toContain("32 seconds");
    const mp3: Sniffed = { kind: "audio", ext: "mp3", mime: "audio/mpeg", container: "MP3" };
    const withCover = {
      format: { duration: "3.0" },
      streams: [
        { codec_type: "audio", codec_name: "mp3" },
        { codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } },
      ],
    };
    expect(judgeMedia(mp3, withCover, 1000)).toEqual({ duration_seconds: 3 });
    expect(() => judgeMedia(mp3, withCover, 2 * 1024 * 1024 + 1)).toThrow(/at most 2 MiB/);
  });
});
