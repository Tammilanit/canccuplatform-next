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

export class ScreenCache {
  private naming: Promise<void> = Promise.resolve();

  constructor(private readonly env: WorkerEnv) {}

  private bundleFiles(): string[] {
    const base = `/screen/b/${encodeURIComponent(this.env.version)}`;
    return [`${base}/player.js`, `${base}/player.css`];
  }

  /** The loader and this version's bundle, so a cold boot offline has a page to start. */
  async install(): Promise<void> {
    const shell = await this.env.caches.open(SHELL_CACHE);
    for (const path of [LOADER, ...this.bundleFiles()]) {
      try {
        const response = await this.env.fetch(path, { cache: "no-store" });
        if (response.ok) await shell.put(path, response);
      } catch {
        // Installed while offline: the page caches what it reads once the network is back.
      }
    }
  }

  /** Older bundles go; the files cache is the page's to name (`name`). */
  async activate(): Promise<void> {
    const keep = new Set([SHELL_CACHE, FILES_CACHE, STATE_CACHE]);
    for (const name of await this.env.caches.keys()) {
      if (name.startsWith("canccu-screen-") && !keep.has(name)) await this.env.caches.delete(name);
    }
    const shell = await this.env.caches.open(SHELL_CACHE);
    const current = new Set(this.bundleFiles());
    for (const request of await shell.keys()) {
      const path = new URL(request.url).pathname;
      if (path.startsWith("/screen/b/") && !current.has(path)) await shell.delete(request);
    }
  }

  /** The answer to a fetch, or null to leave it to the network as if no worker were there. */
  respond(request: Request): Promise<Response> | null {
    if (request.method !== "GET") return null;
    const url = new URL(request.url);
    if (url.origin !== this.env.origin) return null;
    if (url.pathname === LOADER && request.mode === "navigate") return this.loader(request);
    if (isImmutable(url.pathname)) return this.immutable(request, url.pathname);
    return null;
  }

  private async loader(request: Request): Promise<Response> {
    const shell = await this.env.caches.open(SHELL_CACHE);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        resolve(null);
      }, this.env.timeoutMs ?? LOADER_TIMEOUT_MS);
    });
    const network = this.env.fetch(request).then(
      async (response) => {
        // The cached copy is only for when the server cannot be reached: a 5xx is cached never.
        if (response.ok) await shell.put(LOADER, response.clone());
        return response;
      },
      () => null,
    );
    const first = await Promise.race([network, late]);
    clearTimeout(timer);
    if (first !== null && first.status < 500) return first;
    const cached = await shell.match(LOADER);
    if (cached !== undefined) return cached;
    return (await network) ?? Response.error();
  }

  private async immutable(request: Request, path: string): Promise<Response> {
    const cache = await this.env.caches.open(cacheFor(path));
    const range = request.headers.get("range");
    const hit = await cache.match(path);
    if (hit !== undefined) return range === null ? hit : ranged(hit, range);
    const response = await this.env.fetch(request);
    // Only a whole file is kept; a range read leaves it to the prefetch of the state's files.
    if (response.status === 200 && range === null) await cache.put(path, response.clone());
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
    for (let i = 0; i < queue.length; i++) {
      const path = queue[i] as string;
      let hit = await files.match(path);
      if (hit === undefined) {
        try {
          const response = await this.env.fetch(path);
          if (response.status !== 200) continue;
          await files.put(path, response.clone());
          hit = response;
        } catch {
          continue;
        }
      }
      if (path.endsWith(".css")) {
        for (const named of cssFiles(await hit.clone().text())) {
          if (!keep.has(named)) {
            keep.add(named);
            queue.push(named);
          }
        }
      }
    }
    for (const request of await files.keys()) {
      if (!keep.has(new URL(request.url).pathname)) await files.delete(request);
    }
  }
}
