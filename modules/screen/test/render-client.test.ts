/**
 * The renderer's socket protocol from screen's side (modules/screen-render, server.py): the deck
 * goes out, slides come back, and nothing the renderer says is trusted (plan #184, R4).
 */
import type { ReadStream } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RendererUnavailable, openRenderer, renderDeck } from "../src/render/client.js";
import type { RenderOutcome } from "../src/render/client.js";

/** Every deck stream the client opens, so a test can see that none is left open. */
const decks = vi.hoisted(() => [] as ReadStream[]);
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    createReadStream: (...args: Parameters<typeof fs.createReadStream>) => {
      const stream = fs.createReadStream(...args);
      decks.push(stream);
      return stream;
    },
  };
});

type Script = (socket: Socket, request: { header: Record<string, unknown>; deck: Buffer }) => void;

let dir: string;
let server: Server | null = null;
let received: { header: Record<string, unknown>; deck: Buffer } | null = null;
let closed: Promise<void>;

/** A renderer that reads one request, then follows `script`. */
async function fakeRenderer(script: Script): Promise<string> {
  const path = join(dir, "render.sock");
  let markClosed: () => void = () => undefined;
  closed = new Promise((resolve) => (markClosed = resolve));
  server = createServer((socket) => {
    let buf = Buffer.alloc(0);
    socket.on("close", markClosed);
    socket.on("data", (chunk: Buffer) => {
      if (received !== null) return;
      buf = Buffer.concat([buf, chunk]);
      const nl = buf.indexOf(10);
      if (nl < 0) return;
      const header = JSON.parse(buf.subarray(0, nl).toString()) as Record<string, unknown>;
      const deck = buf.subarray(nl + 1);
      if (deck.length < Number(header.size)) return;
      received = { header, deck };
      script(socket, received);
    });
  });
  await new Promise<void>((resolve) => server?.listen(path, resolve));
  return path;
}

const line = (socket: Socket, body: unknown): boolean => socket.write(`${JSON.stringify(body)}\n`);

async function pngOf(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 9, g: 9, b: 9 } } })
    .png()
    .toBuffer();
}

async function sendSlide(socket: Socket, index: number, png: Buffer, meta = {}): Promise<void> {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  line(socket, { slide: { index, width, height, bytes: png.length, ...meta } });
  socket.write(png);
  await Promise.resolve();
}

async function run(
  path: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ outcome: RenderOutcome; slides: { index: number; png: Buffer }[] }> {
  const deckPath = join(dir, "deck.pdf");
  await writeFile(deckPath, Buffer.from("%PDF-1.4 a deck"));
  const slides: { index: number; png: Buffer }[] = [];
  const outcome = await renderDeck({
    socket: await openRenderer(path),
    deckPath,
    signal: opts.signal ?? new AbortController().signal,
    timeoutMs: opts.timeoutMs ?? 10_000,
    onSlide: (slide, png) => {
      slides.push({ index: slide.index, png });
      return Promise.resolve();
    },
  });
  return { outcome, slides };
}

describe("the render socket client", () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "canccu-render-client-"));
    received = null;
    decks.length = 0;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (server)
        server.close(() => {
          resolve();
        });
      else resolve();
    });
    server = null;
    await rm(dir, { recursive: true, force: true });
  });

  it("sends the deck after one header line and reads the slides and warnings back", async () => {
    const one = await pngOf(32, 18);
    const two = await pngOf(18, 32);
    const path = await fakeRenderer((socket) => {
      void (async () => {
        await sendSlide(socket, 1, one);
        await sendSlide(socket, 2, two);
        line(socket, {
          ok: true,
          slide_count: 2,
          warnings: [
            {
              code: "font_missing",
              font: "Fancy",
              slides: [2],
              message: "Fancy drawn as DejaVu Sans.",
            },
          ],
        });
      })();
    });
    const { outcome, slides } = await run(path);
    expect(received?.header).toEqual({ op: "render", size: 15 });
    expect(received?.deck.toString()).toBe("%PDF-1.4 a deck");
    expect(slides.map((s) => s.index)).toEqual([1, 2]);
    expect(slides[0]?.png.equals(one)).toBe(true);
    expect(outcome).toEqual({
      ok: true,
      slides: [
        { index: 1, width: 32, height: 18, bytes: one.length },
        { index: 2, width: 18, height: 32, bytes: two.length },
      ],
      warnings: [
        {
          code: "font_missing",
          font: "Fancy",
          slides: [2],
          message: "Fancy drawn as DejaVu Sans.",
        },
      ],
    });
  });

  it("passes a refusal's code and message on", async () => {
    const path = await fakeRenderer((socket) => {
      line(socket, {
        ok: false,
        error: { code: "too_many_slides", message: "The deck has 412 slides; the limit is 300." },
      });
    });
    expect((await run(path)).outcome).toEqual({
      ok: false,
      code: "too_many_slides",
      message: "The deck has 412 slides; the limit is 300.",
    });
  });

  it("turns an unknown error code into renderer_failed", async () => {
    const path = await fakeRenderer((socket) => {
      line(socket, { ok: false, error: { code: "pwned", message: "<script>" } });
    });
    const { outcome } = await run(path);
    expect(outcome).toMatchObject({ ok: false, code: "renderer_failed" });
    expect(JSON.stringify(outcome)).not.toContain("pwned");
  });

  it.each([
    [
      "a slide that is not a PNG",
      (s: Socket) => {
        line(s, { slide: { index: 1, width: 32, height: 18, bytes: 8 } });
        s.write(Buffer.from("GIF89a!!"));
        line(s, { ok: true, slide_count: 1, warnings: [] });
        return Promise.resolve();
      },
    ],
    [
      "a slide larger than 3840×2160",
      async (s: Socket) => {
        await sendSlide(s, 1, await pngOf(32, 18), { width: 4000 });
        line(s, { ok: true, slide_count: 1, warnings: [] });
      },
    ],
    [
      "a slide whose header disagrees with its PNG",
      async (s: Socket) => {
        await sendSlide(s, 1, await pngOf(32, 18), { height: 20 });
        line(s, { ok: true, slide_count: 1, warnings: [] });
      },
    ],
    [
      "slides out of order",
      async (s: Socket) => {
        await sendSlide(s, 2, await pngOf(32, 18));
        line(s, { ok: true, slide_count: 1, warnings: [] });
      },
    ],
    [
      "a slide count that disagrees with the slides",
      async (s: Socket) => {
        await sendSlide(s, 1, await pngOf(32, 18));
        line(s, { ok: true, slide_count: 3, warnings: [] });
      },
    ],
    [
      "no slides at all",
      (s: Socket) => {
        line(s, { ok: true, slide_count: 0, warnings: [] });
        return Promise.resolve();
      },
    ],
    [
      "a line that is not JSON",
      (s: Socket) => {
        s.write("hello\n");
        return Promise.resolve();
      },
    ],
    [
      "a hang-up mid-stream",
      async (s: Socket) => {
        const png = await pngOf(32, 18);
        line(s, { slide: { index: 1, width: 32, height: 18, bytes: png.length } });
        s.end(png.subarray(0, 10));
      },
    ],
  ])("fails the job as renderer_failed on %s", async (_name, script) => {
    const path = await fakeRenderer((socket) => void script(socket));
    const { outcome } = await run(path);
    expect(outcome).toMatchObject({ ok: false, code: "renderer_failed" });
  });

  it("fails as renderer_failed, without crashing, when the deck cannot be read", async () => {
    const path = await fakeRenderer(() => undefined);
    const outcome = await renderDeck({
      socket: await openRenderer(path),
      deckPath: dir,
      signal: new AbortController().signal,
      timeoutMs: 5_000,
      onSlide: () => Promise.resolve(),
    });
    expect(outcome).toMatchObject({ ok: false, code: "renderer_failed" });
  });

  it("hangs up, sending nothing, when the deck vanished before the render", async () => {
    const path = await fakeRenderer(() => undefined);
    const running = renderDeck({
      socket: await openRenderer(path),
      deckPath: join(dir, "collected.pdf"),
      signal: new AbortController().signal,
      timeoutMs: 5_000,
      onSlide: () => Promise.resolve(),
    });
    await expect(running).rejects.toThrow(/ENOENT/);
    await closed;
    expect(received).toBeNull();
  });

  it("closes the deck when the renderer hangs up in the middle of the upload", async () => {
    const path = join(dir, "render.sock");
    server = createServer((socket) => {
      socket.once("data", () => socket.destroy());
    });
    await new Promise<void>((resolve) => server?.listen(path, resolve));
    const deckPath = join(dir, "big.pdf");
    // Far more than the socket buffers, so the upload is cut off part way.
    await writeFile(deckPath, Buffer.alloc(16 * 1024 * 1024));
    const outcome = await renderDeck({
      socket: await openRenderer(path),
      deckPath,
      signal: new AbortController().signal,
      timeoutMs: 5_000,
      onSlide: () => Promise.resolve(),
    });
    expect(outcome).toMatchObject({ ok: false, code: "renderer_failed" });
    expect(decks).toHaveLength(1);
    expect(decks[0]?.bytesRead).toBeLessThan(16 * 1024 * 1024);
    expect(decks[0]?.destroyed).toBe(true);
  });

  it("keeps only well-formed warnings, cut to size", async () => {
    const png = await pngOf(32, 18);
    const path = await fakeRenderer((socket) => {
      void (async () => {
        await sendSlide(socket, 1, png);
        line(socket, {
          ok: true,
          slide_count: 1,
          warnings: [
            { code: "font_missing", font: "A", slides: [1, 7, "x"], message: "m".repeat(2000) },
            { code: 5, message: "bad code" },
            "not an object",
          ],
        });
      })();
    });
    const { outcome } = await run(path);
    expect(outcome.ok && outcome.warnings).toEqual([
      { code: "font_missing", font: "A", slides: [1], message: "m".repeat(500) },
    ]);
  });

  it("hangs up when the job is cancelled, which stops the renderer", async () => {
    const path = await fakeRenderer(() => undefined);
    const controller = new AbortController();
    const running = run(path, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await expect(running).rejects.toThrow(/cancelled/);
    await closed;
  });

  it("fails as render_timeout when the renderer outlives the deadline", async () => {
    const path = await fakeRenderer(() => undefined);
    const { outcome } = await run(path, { timeoutMs: 100 });
    expect(outcome).toMatchObject({ ok: false, code: "render_timeout" });
    await closed;
  });

  it("refuses a socket path that is missing or not a socket, without connecting", async () => {
    await expect(run(join(dir, "missing.sock"))).rejects.toBeInstanceOf(RendererUnavailable);
    const path = await fakeRenderer(() => undefined);
    const link = join(dir, "link.sock");
    await symlink(path, link);
    await expect(run(link)).rejects.toBeInstanceOf(RendererUnavailable);
    expect(received).toBeNull();
  });
});
