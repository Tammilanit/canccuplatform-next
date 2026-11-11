/** The service worker's cache rules, against an in-memory Cache Storage and a fake network. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FILES_CACHE,
  LOADER_TIMEOUT_MS,
  SHELL_CACHE,
  STATE_CACHE,
  ScreenCache,
  ranged,
} from "../src/sw-core.js";
import { FakeCaches, cachePath } from "./fake.js";

const ORIGIN = "https://alpha.test";
const pathOf = (key: RequestInfo | URL): string => cachePath(key, ORIGIN);

/** The network: a body per path; anything else is 404, and `down` makes every read fail. */
class Net {
  files = new Map<string, string>();
  down = false;
  hang = false;
  status = 200;
  reads: string[] = [];
  fetch = (input: RequestInfo | URL): Promise<Response> => {
    const path = pathOf(input);
    this.reads.push(path);
    if (this.hang) return new Promise<Response>(() => undefined);
    if (this.down) return Promise.reject(new TypeError("Failed to fetch"));
    const body = this.files.get(path);
    if (body === undefined) return Promise.resolve(new Response("no", { status: 404 }));
    return Promise.resolve(new Response(body, { status: this.status }));
  };
}

/** A request as the worker sees one; a navigation cannot be built with `new Request`. */
const req = (
  path: string,
  opts: { mode?: string; range?: string; method?: string; origin?: string } = {},
) =>
  ({
    url: (opts.origin ?? ORIGIN) + path,
    method: opts.method ?? "GET",
    mode: opts.mode ?? "cors",
    headers: new Headers(opts.range === undefined ? {} : { range: opts.range }),
  }) as unknown as Request;

function setup(version = "2.0.0") {
  const caches = new FakeCaches();
  const net = new Net();
  const sw = new ScreenCache({
    caches: caches as unknown as CacheStorage,
    fetch: net.fetch,
    version,
    origin: ORIGIN,
  });
  return { caches, net, sw };
}

const text = async (answer: Promise<Response> | null): Promise<string> =>
  answer === null ? "(network)" : (await answer).text();

describe("the screen's service worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("installs the loader and its version's bundle, and drops older bundles on activate", async () => {
    const { caches, net, sw } = setup();
    net.files.set("/screen/", "loader v2");
    net.files.set("/screen/b/2.0.0/player.js", "js");
    net.files.set("/screen/b/2.0.0/player.css", "css");
    const shell = await caches.open(SHELL_CACHE);
    await shell.put("/screen/b/1.0.0/player.js", new Response("old"));
    await caches.open("canccu-screen-old");
    await caches.open(STATE_CACHE);
    await sw.install();
    await sw.activate();
    expect([...shell.entries.keys()].sort()).toEqual([
      "/screen/",
      "/screen/b/2.0.0/player.css",
      "/screen/b/2.0.0/player.js",
    ]);
    expect((await caches.keys()).sort()).toEqual([SHELL_CACHE, STATE_CACHE].sort());
  });

  it("reads the loader from the network, and from the cache when the network fails or hangs", async () => {
    const { net, sw } = setup();
    net.files.set("/screen/", "loader 1");
    const nav = () => sw.respond(req("/screen/", { mode: "navigate" }));
    expect(await text(nav())).toBe("loader 1");
    net.down = true;
    expect(await text(nav())).toBe("loader 1");
    net.down = false;
    net.status = 502;
    expect(await text(nav())).toBe("loader 1");
    net.status = 200;
    net.hang = true;
    const slow = text(nav());
    await vi.advanceTimersByTimeAsync(LOADER_TIMEOUT_MS);
    expect(await slow).toBe("loader 1");
  });

  it("leaves the API, other pages, other origins and writes to the network", () => {
    const { sw } = setup();
    expect(sw.respond(req("/api/screen/device/state"))).toBeNull();
    expect(sw.respond(req("/api/screen/device/stream"))).toBeNull();
    expect(sw.respond(req("/screen/zones/main", { mode: "navigate" }))).toBeNull();
    expect(sw.respond(req("/api/screen/files/a.jpg", { method: "POST" }))).toBeNull();
    expect(sw.respond(req("/theming/a/x.css", { origin: "https://other.test" }))).toBeNull();
  });

  it("serves immutable files from the cache first, and keeps the ones it reads", async () => {
    const { net, sw } = setup();
    net.files.set("/theming/sandbox/7/clock/index.html", "embed");
    expect(await text(sw.respond(req("/theming/sandbox/7/clock/index.html")))).toBe("embed");
    net.down = true;
    expect(await text(sw.respond(req("/theming/sandbox/7/clock/index.html")))).toBe("embed");
    expect(net.reads.filter((p) => p.startsWith("/theming/sandbox/"))).toHaveLength(1);
  });

  it("answers a media element's range read from a cached file", async () => {
    const whole = new Response("0123456789", { headers: { "content-type": "video/mp4" } });
    const part = await ranged(whole.clone(), "bytes=2-5");
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await part.text()).toBe("2345");
    expect(await (await ranged(whole.clone(), "bytes=7-")).text()).toBe("789");
    expect(await (await ranged(whole.clone(), "bytes=-3")).text()).toBe("789");
    expect((await ranged(whole.clone(), "bytes=20-")).status).toBe(416);
  });

  it("keeps the files the state names, with the fonts its CSS names, and evicts the rest", async () => {
    const { caches, net, sw } = setup();
    net.files.set("/theming/a/t.css", '@font-face{src:url("/theming/a/f.woff2")}');
    net.files.set("/theming/a/f.woff2", "font");
    net.files.set("/api/screen/files/a.jpg", "a");
    net.files.set("/api/screen/files/b.jpg", "b");
    await sw.name(["/theming/a/t.css", "/api/screen/files/a.jpg"]);
    const files = await caches.open(FILES_CACHE);
    expect([...files.entries.keys()].sort()).toEqual([
      "/api/screen/files/a.jpg",
      "/theming/a/f.woff2",
      "/theming/a/t.css",
    ]);
    await sw.name(["/theming/a/t.css", "/api/screen/files/b.jpg", "/api/screen/device/state"]);
    expect([...files.entries.keys()].sort()).toEqual([
      "/api/screen/files/b.jpg",
      "/theming/a/f.woff2",
      "/theming/a/t.css",
    ]);
    // Named again while offline: what is cached stays, nothing is lost.
    net.down = true;
    await sw.name(["/theming/a/t.css", "/api/screen/files/b.jpg", "/api/screen/files/c.jpg"]);
    expect(files.entries.has("/api/screen/files/b.jpg")).toBe(true);
    expect(files.entries.has("/theming/a/f.woff2")).toBe(true);
  });
});
