import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { withTenant } from "@canccu/kit";
import { MemoryKv } from "../src/kv.js";
import { ART_WIDTH, ArtCache, coverPath, edgeReader } from "../src/stage/art.js";

const TENANT = "demo";
const OTHER = "other-event";

/** A cover: white on its left half, black on its right. */
const cover = (): Promise<Buffer> =>
  sharp({ create: { width: 1200, height: 600, channels: 3, background: "#000000" } })
    .composite([
      {
        input: { create: { width: 600, height: 600, channels: 3, background: "#ffffff" } },
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();

function reader(bytes: Buffer | null) {
  const calls: [string, string][] = [];
  return {
    calls,
    read: (host: string, path: string) => {
      calls.push([host, path]);
      return Promise.resolve(bytes);
    },
  };
}

describe("the stage's art", () => {
  it("takes only a path on the event's hostname", () => {
    expect(coverPath("/games/covers/g_1.webp")).toBe("/games/covers/g_1.webp");
    for (const bad of [
      "https://elsewhere.example/c.png",
      "//elsewhere.example/c.png",
      "/a\\b",
      "games/c.png",
      "/a b",
      42,
      null,
    ])
      expect(coverPath(bad)).toBeNull();
  });

  it("blurs a cover once to 640 px WebP, keeps it per event and serves its bytes by id", async () => {
    const r = reader(await cover());
    const art = new ArtCache(new MemoryKv(), r.read);
    const info = await withTenant(TENANT, () => art.of("event.example", "/games/covers/g_1.png"));
    expect(info?.id).toMatch(/^[a-f0-9]{64}$/);
    const bytes = await withTenant(TENANT, () => art.bytes(info?.id ?? ""));
    const meta = await sharp(bytes ?? Buffer.alloc(0)).metadata();
    expect([meta.format, meta.width]).toEqual(["webp", ART_WIDTH]);
    // The cover's extremes are its own; the blur pulls the art's in from pure white and black.
    expect(info?.cover).toEqual({ light: [255, 255, 255], dark: [0, 0, 0] });
    expect(info?.art.light[0]).toBeGreaterThan(200);
    expect(info?.art.dark[0]).toBeLessThan(55);
    // Read once: the second compose takes it from the cache.
    await withTenant(TENANT, () => art.of("event.example", "/games/covers/g_1.png"));
    expect(r.calls).toEqual([["event.example", "/games/covers/g_1.png"]]);
    // Another event never reaches it.
    expect(await withTenant(OTHER, () => art.bytes(info?.id ?? ""))).toBeNull();
  });

  it("never reads another host", async () => {
    const r = reader(await cover());
    const art = new ArtCache(new MemoryKv(), r.read);
    expect(
      await withTenant(TENANT, () => art.of("event.example", "//evil.example/x.png")),
    ).toBeNull();
    expect(r.calls).toEqual([]);
  });

  it("refuses what is no PNG, JPEG or WebP by its content, and does not try again for 10 minutes", async () => {
    let now = 0;
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    const r = reader(svg);
    const art = new ArtCache(new MemoryKv(() => now), r.read);
    const of = () => withTenant(TENANT, () => art.of("event.example", "/c.svg"));
    expect(await of()).toBeNull();
    expect(await of()).toBeNull();
    expect(r.calls).toHaveLength(1);
    now += 10 * 60_000 + 1;
    expect(await of()).toBeNull();
    expect(r.calls).toHaveLength(2);
  });

  it("makes the art again once its bytes are gone", async () => {
    const kv = new MemoryKv();
    const r = reader(await cover());
    const art = new ArtCache(kv, r.read);
    const info = await withTenant(TENANT, () => art.of("event.example", "/c.png"));
    await kv.del(`t:${TENANT}:screen:art:bytes:${info?.id ?? ""}`);
    const again = await withTenant(TENANT, () => art.of("event.example", "/c.png"));
    expect(again?.id).toBe(info?.id);
    expect(r.calls).toHaveLength(2);
  });

  it("shares a read already in flight between composes", async () => {
    const bytes = await cover();
    const calls: string[] = [];
    let release: (b: Buffer) => void = () => undefined;
    const slow = new Promise<Buffer>((resolve) => (release = resolve));
    const art = new ArtCache(new MemoryKv(), (_host, path) => {
      calls.push(path);
      return slow;
    });
    const of = () => withTenant(TENANT, () => art.of("event.example", "/c.png"));
    const both = Promise.all([of(), of()]);
    release(bytes);
    const [a, b] = await both;
    expect(a?.id).toMatch(/^[a-f0-9]{64}$/);
    expect(b?.id).toBe(a?.id);
    expect(calls).toEqual(["/c.png"]);
    // Another event's compose of the same path reads its own.
    await withTenant(OTHER, () => art.of("event.example", "/c.png"));
    expect(calls).toHaveLength(2);
  });

  it("refuses a cover of more than about 40 Mpx instead of decoding it", async () => {
    // 7000 × 6000 = 42 Mpx, a small file: one colour compresses to almost nothing.
    const huge = await sharp({
      create: { width: 7000, height: 6000, channels: 3, background: "#336699" },
    })
      .png({ compressionLevel: 1 })
      .toBuffer();
    const art = new ArtCache(new MemoryKv(), reader(huge).read);
    expect(await withTenant(TENANT, () => art.of("event.example", "/huge.png"))).toBeNull();
  });

  it("gives up on a cover that trickles in past the overall deadline", async () => {
    // A byte every 50 ms never trips the socket's idle timeout; only the deadline ends it.
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "image/png" });
      const drip = setInterval(() => res.write(Buffer.from([0])), 50);
      res.on("close", () => {
        clearInterval(drip);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const read = edgeReader(`http://127.0.0.1:${port}`, 300);
      const started = Date.now();
      const late = new Promise<"late">((resolve) =>
        setTimeout(() => {
          resolve("late");
        }, 2000),
      );
      expect(await Promise.race([read("event.example", "/slow.png"), late])).toBeNull();
      expect(Date.now() - started).toBeLessThan(1500);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
