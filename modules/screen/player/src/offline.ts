/**
 * The kiosk's offline store (contracts/screen.md, Offline; plan #109, S9): the last state in
 * Cache Storage, so a kiosk that boots without the uplink draws what it showed last, and the
 * names of the files that state needs, which the service worker keeps (sw-core.ts). Browsers
 * offer neither outside a secure context (the plain-http IP-mode stack): the store then does
 * nothing, and the screen behaves as before.
 */
import { namedFiles } from "./cacheable.js";
import { isState } from "./state.js";
import type { ScreenState } from "./state.js";
import { STATE_CACHE } from "./sw-core.js";

const STATE_KEY = "/screen/offline/state";
const SEEN_KEY = "/screen/offline/seen";
/** Bursts of pushes are written once. */
export const SAVE_DELAY_MS = 1000;
/** How often "the server was heard" is written down while it keeps being heard. */
export const SEEN_EVERY_MS = 60_000;

export interface Saved {
  state: ScreenState;
  /** When the page last heard from the server (this device's clock): "offline since". */
  seenAt: number;
}

export interface OfflineEnv {
  caches: CacheStorage | undefined;
  worker: ServiceWorkerContainer | undefined;
  origin: string;
  now: () => number;
}

const json = (value: unknown): Response =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

export class OfflineStore {
  private pending: ScreenState | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private seenWritten = -Infinity;
  /** The last state written, for a worker that takes control later. */
  private last: ScreenState | null = null;

  constructor(private readonly env: OfflineEnv) {}

  register(bundle: string): void {
    // The first page load runs before its worker controls it; once it does, it learns the files.
    this.env.worker?.addEventListener("controllerchange", () => {
      this.nameFiles();
    });
    void this.env.worker
      ?.register(`/screen/sw.js?v=${encodeURIComponent(bundle)}`, { scope: "/screen/" })
      .catch(() => undefined);
  }

  /** Keep `state` as the last one (after a short wait, so a burst is one write). */
  save(state: ScreenState): void {
    this.pending = state;
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, SAVE_DELAY_MS);
  }

  /** The server answered or the stream spoke: written down at most once a minute. */
  seen(): void {
    const now = this.env.now();
    if (now - this.seenWritten < SEEN_EVERY_MS) return;
    this.seenWritten = now;
    void this.put(SEEN_KEY, now);
  }

  async load(): Promise<Saved | null> {
    try {
      const cache = await this.env.caches?.open(STATE_CACHE);
      const state: unknown = await (await cache?.match(STATE_KEY))?.json();
      if (!isState(state)) return null;
      const seen: unknown = await (await cache?.match(SEEN_KEY))?.json();
      return { state, seenAt: typeof seen === "number" ? seen : this.env.now() };
    } catch {
      return null;
    }
  }

  private async flush(): Promise<void> {
    const state = this.pending;
    if (state === null) return;
    this.pending = null;
    await this.put(STATE_KEY, state);
    this.seenWritten = this.env.now();
    await this.put(SEEN_KEY, this.seenWritten);
    this.last = state;
    this.nameFiles();
  }

  private nameFiles(): void {
    if (this.last === null) return;
    this.env.worker?.controller?.postMessage({
      type: "canccu-screen-files",
      files: namedFiles(this.last, this.env.origin),
    });
  }

  private async put(key: string, value: unknown): Promise<void> {
    try {
      await (await this.env.caches?.open(STATE_CACHE))?.put(key, json(value));
    } catch {
      // A full or refused store: the screen plays on, it just cannot boot from it.
    }
  }
}
