/**
 * Video and sound checks with `ffprobe` (plan #108, D8): the screens play MP4 (H.264 or H.265,
 * AAC or no audio) and WebM (VP8, VP9 or AV1, Opus, Vorbis or no audio), and claim sounds in MP3
 * or OGG of at most 2 MiB and 30 seconds. Anything else is refused with a message that names what
 * was found and what to export instead, read from the file, so an organiser can fix it alone.
 * Replaces the legacy box and EBML parsers, which read the length but never the codecs.
 */
import { execFile } from "node:child_process";
import { KitError } from "@canccu/kit";
import { invalidRequest } from "../http.js";
import type { Sniffed, Unplayable } from "./sniff.js";

export const MAX_SOUND_BYTES = 2 * 1024 * 1024;
export const MAX_SOUND_SECONDS = 30;

export interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  disposition?: { attached_pic?: number };
}

export interface FfprobeOutput {
  format?: { duration?: string };
  streams?: FfprobeStream[];
}

export type Ffprobe = (path: string) => Promise<FfprobeOutput>;

/** The binary comes from `CANCCU_FFPROBE` or the PATH (Debian's `ffmpeg` package in the image). */
export function ffprobe(bin = process.env.CANCCU_FFPROBE ?? "ffprobe"): Ffprobe {
  const args = ["-v", "error", "-print_format", "json", "-show_format", "-show_streams"];
  return (path) =>
    new Promise((resolve, reject) => {
      execFile(bin, [...args, path], { timeout: 30_000, maxBuffer: 1 << 20 }, (err, stdout) => {
        if (err) {
          reject(new Error(`ffprobe failed: ${err.message}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as FfprobeOutput);
        } catch {
          reject(new Error("ffprobe printed no JSON"));
        }
      });
    });
}

const mediaUnsupported = (message: string): KitError =>
  new KitError(message, { status: 400, code: "media_unsupported" });

const VIDEO: Record<string, { video: string[]; audio: string[] }> = {
  mp4: { video: ["h264", "hevc"], audio: ["aac"] },
  webm: { video: ["vp8", "vp9", "av1"], audio: ["opus", "vorbis"] },
};
const SOUND: Record<string, string[]> = { mp3: ["mp3"], ogg: ["vorbis", "opus"] };

const CODEC_NAMES: Record<string, string> = {
  h264: "H.264",
  hevc: "H.265",
  prores: "ProRes",
  mpeg4: "MPEG-4 Part 2",
  mpeg2video: "MPEG-2",
  vp8: "VP8",
  vp9: "VP9",
  av1: "AV1",
  aac: "AAC",
  mp3: "MP3",
  opus: "Opus",
  vorbis: "Vorbis",
  ac3: "AC-3",
  flac: "FLAC",
};

function codecName(codec: string | undefined): string {
  if (codec === undefined) return "unknown";
  if (codec.startsWith("pcm_")) return "PCM";
  return CODEC_NAMES[codec] ?? codec.toUpperCase();
}

/** Cover art in an MP3 shows up as a video stream; it is a picture, not video. */
function streams(out: FfprobeOutput, type: "video" | "audio"): string[] {
  return (out.streams ?? [])
    .filter((s) => s.codec_type === type && s.disposition?.attached_pic !== 1)
    .map((s) => s.codec_name ?? "unknown");
}

function described(container: string, video: string[], audio: string[]): string {
  const parts = [
    ...video.map((c) => `${codecName(c)} video`),
    ...audio.map((c) => `${codecName(c)} audio`),
  ];
  return parts.length === 0 ? container : `${container} with ${parts.join(" and ")}`;
}

function seconds(out: FfprobeOutput): number | null {
  const value = Number.parseFloat(out.format?.duration ?? "");
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** What the file is worth keeping as, or the 400 that tells the organiser what to do. */
export function judgeMedia(
  sniffed: Sniffed | Unplayable,
  out: FfprobeOutput,
  bytes: number,
): { duration_seconds: number | null } {
  const video = streams(out, "video");
  const audio = streams(out, "audio");
  const what = described(sniffed.container, video, audio);
  const exportAs = video.length > 0 ? "MP4 (H.264)" : "MP3 or OGG";
  if (sniffed.kind === "unplayable") {
    throw mediaUnsupported(`This file is ${what}. Export it as ${exportAs}.`);
  }
  if (sniffed.kind === "video") {
    const rule = VIDEO[sniffed.ext] ?? { video: [], audio: [] };
    if (video.length === 0) {
      throw mediaUnsupported(`This file is ${what}, with no video. Export a sound as MP3 or OGG.`);
    }
    const ok =
      video.every((c) => rule.video.includes(c)) && audio.every((c) => rule.audio.includes(c));
    if (!ok) throw mediaUnsupported(`This file is ${what}. Export it as MP4 (H.264).`);
    return { duration_seconds: seconds(out) };
  }
  if (
    video.length > 0 ||
    audio.length !== 1 ||
    !(SOUND[sniffed.ext] ?? []).includes(audio[0] ?? "")
  ) {
    throw mediaUnsupported(`This file is ${what}. Export it as ${exportAs}.`);
  }
  if (bytes > MAX_SOUND_BYTES) {
    throw new KitError("A sound may be at most 2 MiB. Shorten it or lower its bit rate.", {
      status: 413,
      code: "file_too_large",
    });
  }
  const length = seconds(out);
  if (length === null) throw invalidRequest("The length of this sound could not be read.");
  if (length > MAX_SOUND_SECONDS) {
    throw invalidRequest(
      `This sound is ${Math.ceil(length)} seconds long; a sound may be at most 30. Trim it.`,
    );
  }
  return { duration_seconds: length };
}
