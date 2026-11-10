/**
 * Screen's side of the renderer's socket (protocol: modules/screen-render, server.py). The
 * renderer parsed an untrusted deck, so every byte it answers is checked here as hostile input
 * (plan #184, R4): slides in order, each a PNG whose size matches its header and fits 3840×2160,
 * at most 300, each under a byte cap; error codes from a fixed list; warnings cut to size. Any
 * other answer fails the job as `renderer_failed`, never anything worse.
 */
import { createReadStream } from "node:fs";
import type { ReadStream } from "node:fs";
import { lstat, stat } from "node:fs/promises";
import { connect } from "node:net";
import type { Socket } from "node:net";

export const MAX_SLIDES = 300;
export const MAX_WIDTH = 3840;
export const MAX_HEIGHT = 2160;
/** A 3840×2160 RGBA PNG that compresses not at all is about 33 MB. */
const MAX_SLIDE_BYTES = 48 * 1024 * 1024;
const MAX_LINE = 64 * 1024;
const MAX_LAST_LINE = 1024 * 1024;
/** Reading pauses while this much is buffered, so a flooding renderer cannot fill memory. */
const HIGH_WATER = 64 * 1024 * 1024;
const MAX_WARNINGS = 50;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RENDERER_CODES = new Set([
  "file_invalid",
  "too_many_slides",
  "render_timeout",
  "renderer_failed",
]);

export type RenderErrorCode =
  | "file_invalid"
  | "too_many_slides"
  | "render_timeout"
  | "renderer_failed"
  | "storage_quota_exceeded";

export interface SlideMeta {
  index: number;
  width: number;
  height: number;
  bytes: number;
}

export interface RenderWarning {
  code: string;
  font: string | null;
  slides: number[];
  message: string;
}

export type RenderOutcome =
  | { ok: true; slides: SlideMeta[]; warnings: RenderWarning[] }
  | { ok: false; code: RenderErrorCode; message: string };

/** No renderer to talk to; the job has not started and goes back to its place. */
export class RendererUnavailable extends Error {}

class Protocol extends Error {}

export const RENDERER_FAILED =
  "The deck could not be drawn. Submit it again; if it fails again, export it as PDF and upload that.";
export const TIMED_OUT =
  "The deck took longer than 10 minutes to draw. Split it into smaller decks, or export it as PDF.";

/** Buffers what the renderer sends and hands it out as lines and byte runs. */
class Reader {
  private buffered: Buffer[] = [];
  private size = 0;
  private done = false;
  private wake: (() => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.buffered.push(chunk);
      this.size += chunk.length;
      if (this.size > HIGH_WATER) socket.pause();
      this.notify();
    });
    const end = (): void => {
      this.done = true;
      this.notify();
    };
    socket.on("end", end);
    socket.on("close", end);
    socket.on("error", end);
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private async more(): Promise<void> {
    if (this.done) throw new Protocol("the renderer hung up");
    this.socket.resume();
    await new Promise<void>((resolve) => (this.wake = resolve));
  }

  private take(n: number): Buffer {
    const all = Buffer.concat(this.buffered);
    this.buffered = n < all.length ? [all.subarray(n)] : [];
    this.size = all.length - n;
    return all.subarray(0, n);
  }

  async line(max: number): Promise<unknown> {
    for (;;) {
      const all = Buffer.concat(this.buffered);
      this.buffered = [all];
      const nl = all.indexOf(10);
      if (nl >= 0 && nl <= max) {
        const text = this.take(nl + 1)
          .subarray(0, nl)
          .toString();
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new Protocol("a line that is not JSON");
        }
      }
      if (all.length > max) throw new Protocol("a line that is too long");
      await this.more();
    }
  }

  async bytes(n: number): Promise<Buffer> {
    while (this.size < n) await this.more();
    return this.take(n);
  }
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

function slideMeta(value: unknown, expected: number): SlideMeta {
  const s = (value as { slide?: Record<string, unknown> }).slide;
  if (
    !s ||
    s.index !== expected ||
    expected > MAX_SLIDES ||
    !isInt(s.width, 1, MAX_WIDTH) ||
    !isInt(s.height, 1, MAX_HEIGHT) ||
    !isInt(s.bytes, 24, MAX_SLIDE_BYTES)
  ) {
    throw new Protocol("a slide header out of bounds");
  }
  return { index: expected, width: s.width, height: s.height, bytes: s.bytes };
}

function checkPng(png: Buffer, meta: SlideMeta): void {
  const ok =
    png.subarray(0, 8).equals(PNG_SIGNATURE) &&
    png.toString("latin1", 12, 16) === "IHDR" &&
    png.readUInt32BE(16) === meta.width &&
    png.readUInt32BE(20) === meta.height;
  if (!ok) throw new Protocol("a slide that is not the PNG its header names");
}

function warnings(value: unknown, slideCount: number): RenderWarning[] {
  if (!Array.isArray(value)) return [];
  const out: RenderWarning[] = [];
  for (const w of value.slice(0, MAX_WARNINGS) as unknown[]) {
    if (typeof w !== "object" || w === null) continue;
    const { code, font, slides, message } = w as Record<string, unknown>;
    if (typeof code !== "string" || !/^[a-z_]{1,64}$/.test(code) || typeof message !== "string") {
      continue;
    }
    out.push({
      code,
      font: typeof font === "string" ? font.slice(0, 200) : null,
      slides: Array.isArray(slides)
        ? (slides as unknown[]).filter((n): n is number => isInt(n, 1, slideCount))
        : [],
      message: message.slice(0, 500),
    });
  }
  return out;
}

function refusal(value: unknown): RenderOutcome {
  const error = (value as { error?: Record<string, unknown> }).error;
  const code = error?.code;
  const message = error?.message;
  if (typeof code === "string" && RENDERER_CODES.has(code)) {
    return {
      ok: false,
      code: code as RenderErrorCode,
      message:
        typeof message === "string" && message.length > 0 && message.length <= 500
          ? message
          : RENDERER_FAILED,
    };
  }
  return { ok: false, code: "renderer_failed", message: RENDERER_FAILED };
}

async function converse(
  reader: Reader,
  onSlide: (slide: SlideMeta, png: Buffer) => Promise<void>,
): Promise<RenderOutcome> {
  const slides: SlideMeta[] = [];
  for (;;) {
    const message = await reader.line(MAX_LINE + MAX_LAST_LINE);
    if (typeof message !== "object" || message === null) throw new Protocol("not an object");
    if ("slide" in message) {
      const meta = slideMeta(message, slides.length + 1);
      const png = await reader.bytes(meta.bytes);
      checkPng(png, meta);
      await onSlide(meta, png);
      slides.push(meta);
      continue;
    }
    const last = message as Record<string, unknown>;
    if (last.ok !== true) return refusal(last);
    if (slides.length === 0 || last.slide_count !== slides.length) {
      throw new Protocol("a slide count that disagrees with the slides");
    }
    return { ok: true, slides, warnings: warnings(last.warnings, slides.length) };
  }
}

/**
 * Connects to the renderer. The path must be a socket itself: the renderer can write to its
 * volume, so a link there is never followed. Node cannot connect through the checked file, so a
 * renderer swapping in a link between the check and the connect still wins; that reaches only
 * Unix sockets in screen's own filesystem, never files, and screen sends them only the deck.
 */
export async function openRenderer(path: string): Promise<Socket> {
  const info = await lstat(path).catch(() => null);
  if (info === null || !info.isSocket())
    throw new RendererUnavailable(`no renderer socket at ${path}`);
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    socket.once("connect", () => {
      resolve(socket);
    });
    socket.once("error", (err) => {
      reject(new RendererUnavailable(String(err)));
    });
  });
}

/**
 * Renders the deck at `deckPath` over `socket` (from `openRenderer`), handing each checked slide
 * to `onSlide` as it arrives. Rejects with "render cancelled" when `signal` aborts, and with what
 * `onSlide` throws; either way it hangs up, which is how the renderer learns to stop.
 */
export async function renderDeck(opts: {
  socket: Socket;
  deckPath: string;
  signal: AbortSignal;
  timeoutMs: number;
  onSlide: (slide: SlideMeta, png: Buffer) => Promise<void>;
}): Promise<RenderOutcome> {
  const socket = opts.socket;
  const reader = new Reader(socket);
  let deck: ReadStream | undefined;
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const stopped = new Promise<RenderOutcome>((resolve, reject) => {
    timer = setTimeout(() => {
      resolve({ ok: false, code: "render_timeout", message: TIMED_OUT });
    }, opts.timeoutMs);
    onAbort = () => {
      reject(new Error("render cancelled"));
    };
    if (opts.signal.aborted) onAbort();
    opts.signal.addEventListener("abort", onAbort, { once: true });
  });
  // A cancel while the deck is still being read must not surface as an unhandled rejection.
  stopped.catch(() => undefined);
  try {
    const size = (await stat(opts.deckPath)).size;
    // Never half-closed: the renderer reads a closed side as the caller leaving.
    socket.write(`${JSON.stringify({ op: "render", size })}\n`);
    // A deck that cannot be read (deleted meanwhile) ends the talk: the hang-up fails the job.
    deck = createReadStream(opts.deckPath).on("error", () => socket.destroy());
    deck.pipe(socket, { end: false });
    const talk = converse(reader, opts.onSlide).catch((err: unknown): RenderOutcome => {
      if (err instanceof Protocol) {
        return { ok: false, code: "renderer_failed", message: RENDERER_FAILED };
      }
      throw err;
    });
    // Once the race is lost (cancel, deadline) a later failure of the talk has no one to tell.
    talk.catch(() => undefined);
    return await Promise.race([talk, stopped]);
  } finally {
    clearTimeout(timer);
    if (onAbort) opts.signal.removeEventListener("abort", onAbort);
    deck?.destroy();
    socket.destroy();
  }
}
