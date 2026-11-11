/**
 * The screen's service worker (plan #109, S9; contracts/screen.md, Offline), apart from the
 * worker's events so it runs in tests: the loader page network-first, immutable files cache-first,
 * and the files the current state names kept, fetched ahead and the rest evicted. It is not an
 * offline-first player: with the network up every read but immutable files goes to the server,
 * and nothing new starts offline. The page keeps the last state itself (offline.ts).
 */
import { cssFiles, isImmutable } from "./cacheable.js";

export const SHELL_CACHE = "canccu-screen-shell";
export const FILES_CACHE = "canccu-screen-files";
/** Written by the page (offline.ts); the worker only keeps it. */
export const STATE_CACHE = "canccu-screen-state";
export const LOADER = "/screen/";
/**
 * A loader read that takes longer falls back to the cached page: with the uplink half down a
 * connect can hang for minutes, and the kiosk would show nothing all that time.
 */
export const LOADER_TIMEOUT_MS = 5000;

/**
 * The fetch event's `waitUntil`: a cache write runs on after the answer has gone, so the page never
 * waits for a large file to be stored, and a write that fails (a full disk) costs only the copy.
 */
export type KeepAlive = (work: Promise<unknown>) => void;

export interface WorkerEnv {
  caches: CacheStorage;
  fetch: typeof fetch;
  /** The bundle version this worker was registered for. */
  version: string;
  origin: string;
  timeoutMs?: number;
}

/** A slice of a cached file for a media element's `Range` read; the whole file when unreadable. */
export async function ranged(hit: Response, range: string): Promise<Response> {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m === null || (m[1] === "" && m[2] === "")) return hit;
  const blob = await hit.blob();
  const size = blob.size;
  const start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      "content-type": hit.headers.get("content-type") ?? "application/octet-stream",
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-length": String(end - start + 1),
      "accept-ranges": "bytes",
    },
  });
}

const cacheFor = (path: string): string =>
  path.startsWith("/screen/b/") ? SHELL_CACHE : FILES_CACHE;

/** The bundle files a loader page names (its `<link href>` and `<script src>`). */
export function loaderBundle(html: string): string[] {
  return [...html.matchAll(/(?:href|src)="(\/screen\/b\/[^"]+)"/g)].map((m) => m[1] as string);
}

/** How many of a state's missing files are fetched at once: fast to fill, yet no flood. */
export const FETCH_AT_ONCE = 4;

export class ScreenCache {
  private naming: Promise<void> = Promise.resolve();

  constructor(private readonly env: WorkerEnv) {}

  private bundleFiles(): string[] {
    const base = `/screen/b/${encodeURIComponent(this.env.version)}`;
    return [`${base}/player.js`, `${base}/player.css`];
  }

  /**
   * This version's bundle and the one the cached loader names. They differ when a page booted
   * from an older cached loader registers the worker while the server already runs the next
   * version: the loader a cold boot gets is the cached one, so its bundle must stay.
   */
  private async keptBundle(shell: Cache): Promise<string[]> {
    const loader = await shell.match(LOADER);
    const named = loader === undefined ? [] : loaderBundle(await loader.text());
    return [...new Set([...this.bundleFiles(), ...named])];
  }

  /** The loader and its bundle, so a cold boot offline has a page to start. */
  async install(): Promise<void> {
    const shell = await this.env.caches.open(SHELL_CACHE);
    const fetchInto = async (path: string): Promise<void> => {
      try {
        const response = await this.env.fetch(path, { cache: "no-store" });
        if (response.ok) await shell.put(path, response);
      } catch {
        // Installed while offline: the page caches what it reads once the network is back.
      }
    };
    await fetchInto(LOADER);
    for (const path of await this.keptBundle(shell)) {
      if ((await shell.match(path)) === undefined) await fetchInto(path);
    }
  }

  /** Older bundles go; the files cache is the page's to name (`name`). */
  async activate(): Promise<void> {
    const keep = new Set([SHELL_CACHE, FILES_CACHE, STATE_CACHE]);
    for (const name of await this.env.caches.keys()) {
      if (name.startsWith("canccu-screen-") && !keep.has(name)) await this.env.caches.delete(name);
    }
    const shell = await this.env.caches.open(SHELL_CACHE);
    const current = new Set(await this.keptBundle(shell));
    for (const request of await shell.keys()) {
      const path = new URL(request.url).pathname;
      if (path.startsWith("/screen/b/") && !current.has(path)) await shell.delete(request);
    }
  }

  /** The answer to a fetch, or null to leave it to the network as if no worker were there. */
  respond(request: Request, keep: KeepAlive): Promise<Response> | null {
    if (request.method !== "GET") return null;
    const url = new URL(request.url);
    if (url.origin !== this.env.origin) return null;
    if (url.pathname === LOADER && request.mode === "navigate") return this.loader(request, keep);
    if (isImmutable(url.pathname)) return this.immutable(request, url.pathname, keep);
    return null;
  }

  private async loader(request: Request, keep: KeepAlive): Promise<Response> {
    const network = this.env.fetch(request).catch(() => null);
    // Registered before anything awaits, while the fetch event still takes `waitUntil`; its clone
    // is taken before the page reads the body. The cached copy is only for when the server cannot
    // be reached: a 5xx is cached never.
    keep(
      network
        .then(async (response) => {
          if (response === null || !response.ok) return;
          const copy = response.clone();
          await (await this.env.caches.open(SHELL_CACHE)).put(LOADER, copy);
        })
        .catch(() => undefined),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        resolve(null);
      }, this.env.timeoutMs ?? LOADER_TIMEOUT_MS);
    });
    const first = await Promise.race([network, late]);
    clearTimeout(timer);
    if (first !== null && first.status < 500) return first;
    const shell = await this.env.caches.open(SHELL_CACHE);
    const cached = await shell.match(LOADER);
    if (cached !== undefined) return cached;
    return (await network) ?? Response.error();
  }

  private async immutable(request: Request, path: string, keep: KeepAlive): Promise<Response> {
    const cache = await this.env.caches.open(cacheFor(path));
    const range = request.headers.get("range");
    const hit = await cache.match(path);
    if (hit !== undefined) return range === null ? hit : ranged(hit, range);
    const response = await this.env.fetch(request);
    // Only a whole file is kept; a range read leaves it to the prefetch of the state's files.
    // Called while `respondWith` is still pending, so `waitUntil` still takes it.
    if (response.status === 200 && range === null) {
      keep(cache.put(path, response.clone()).catch(() => undefined));
    }
    return response;
  }

  /**
   * The files the page's current state names: those missing are fetched now, so they are there
   * when the uplink drops, and every other file goes. One naming at a time, in order.
   */
  name(paths: readonly string[]): Promise<void> {
    this.naming = this.naming.then(() => this.keepOnly(paths)).catch(() => undefined);
    return this.naming;
  }

  private async keepOnly(paths: readonly string[]): Promise<void> {
    const files = await this.env.caches.open(FILES_CACHE);
    const keep = new Set(paths.filter((p) => isImmutable(p) && cacheFor(p) === FILES_CACHE));
    const queue = [...keep];
    // A few workers share the queue; a stylesheet adds the files it names to its end.
    const work = async (): Promise<void> => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        const hit = await this.held(files, path);
        if (hit === null || !path.endsWith(".css")) continue;
        for (const named of cssFiles(await hit.text())) {
          if (!keep.has(named)) {
            keep.add(named);
            queue.push(named);
          }
        }
      }
    };
    // A worker that finds the queue empty ends, so one more round picks up what a late
    // stylesheet added after the others had ended.
    while (queue.length > 0) {
      await Promise.all(Array.from({ length: FETCH_AT_ONCE }, work));
    }
    for (const request of await files.keys()) {
      if (!keep.has(new URL(request.url).pathname)) await files.delete(request);
    }
  }

  /** The cached copy of `path`, fetched and stored first when missing; null when unavailable. */
  private async held(files: Cache, path: string): Promise<Response | null> {
    const hit = await files.match(path);
    if (hit !== undefined) return hit;
    try {
      const response = await this.env.fetch(path);
      if (response.status !== 200) return null;
      await files.put(path, response.clone());
      return response;
    } catch {
      return null;
    }
  }
}
