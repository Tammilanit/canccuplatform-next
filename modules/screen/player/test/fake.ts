/** A fake screen API for the player's tests: one handler per `METHOD path`, and a live stream. */
import { vi } from "vitest";
import type { Nav } from "../src/player.js";
import type { ScreenState } from "../src/state.js";

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const problem = (status: number, code: string): Response =>
  json(status, { error: { code, message: code } });

export function screenState(over: Partial<ScreenState> = {}): ScreenState {
  return {
    state_version: 3,
    time: "2026-01-01T12:00:00Z",
    tenant: { id: "alpha", name: "Demo Event", time_zone: "UTC", status: "live" },
    device: { id: "dv_1", name: "Hall left", mirror: false },
    zone: { key: "main", name: "Main hall", epoch: "e1" },
    bundle: { version: "1.0.0" },
    theme: { revision: 2, tokens_css_url: null, css_url: null, logo_url: null, templates: [] },
    regions: [],
    ticker: null,
    ...over,
  };
}

type Handler = (init?: RequestInit) => Response | Promise<Response>;

export class FakeApi {
  routes = new Map<string, Handler>();
  calls: string[] = [];
  /** Writes into the open stream; undefined while none is open. */
  private control: ReadableStreamDefaultController<Uint8Array> | undefined;
  streamAnswer: () => Response | Promise<Response> = () => this.openStream();

  on(route: string, handler: Handler): this {
    this.routes.set(route, handler);
    return this;
  }

  fetch = vi.fn(async (path: string, init?: RequestInit): Promise<Response> => {
    const route = `${init?.method ?? "GET"} ${path}`;
    this.calls.push(route);
    if (path === "/api/screen/device/stream") return this.streamAnswer();
    if (path === "/api/screen/device/heartbeat" && !this.routes.has(route)) {
      return json(200, { server_time: new Date(Date.now()).toISOString() });
    }
    const handler = this.routes.get(route);
    if (handler === undefined) return problem(404, "not_found");
    return handler(init);
  });

  openStream(): Response {
    const body = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.control = c;
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  send(event: string, data: unknown, id = ""): void {
    const head = id === "" ? "" : `id: ${id}\n`;
    this.control?.enqueue(
      new TextEncoder().encode(`${head}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    );
  }

  dropStream(): void {
    this.control?.close();
    this.control = undefined;
  }
}

export function fakeNav(hash = ""): Nav & { hashValue: string; went: string[]; reloads: number } {
  const nav = {
    hashValue: hash,
    went: [] as string[],
    reloads: 0,
    hash: () => nav.hashValue,
    clearHash: () => {
      nav.hashValue = "";
    },
    origin: () => "https://alpha.test",
    go: (url: string) => {
      nav.went.push(url);
    },
    reload: () => {
      nav.reloads += 1;
    },
  };
  return nav;
}

/** A cache key as the path it stands for on `origin`. */
export const cachePath = (key: RequestInfo | URL, origin = "https://alpha.test"): string =>
  new URL(typeof key === "string" ? key : key instanceof URL ? key.href : key.url, origin).pathname;
const pathOf = (key: RequestInfo | URL): string => cachePath(key);

/** Cache Storage in memory, for the service worker and the offline store. */
export class FakeCache {
  readonly entries = new Map<string, { body: ArrayBuffer; init: ResponseInit }>();
  async put(key: RequestInfo | URL, response: Response): Promise<void> {
    const headers = Object.fromEntries(response.headers.entries());
    const body = await response.arrayBuffer();
    this.entries.set(pathOf(key), { body, init: { status: response.status, headers } });
  }
  match(key: RequestInfo | URL): Promise<Response | undefined> {
    const hit = this.entries.get(pathOf(key));
    return Promise.resolve(hit && new Response(hit.body.slice(0), hit.init));
  }
  delete(key: RequestInfo | URL): Promise<boolean> {
    return Promise.resolve(this.entries.delete(pathOf(key)));
  }
  keys(): Promise<Request[]> {
    return Promise.resolve(
      [...this.entries.keys()].map((p) => new Request(`https://alpha.test${p}`)),
    );
  }
}

export class FakeCaches {
  readonly named = new Map<string, FakeCache>();
  open(name: string): Promise<FakeCache> {
    const cache = this.named.get(name) ?? new FakeCache();
    this.named.set(name, cache);
    return Promise.resolve(cache);
  }
  keys(): Promise<string[]> {
    return Promise.resolve([...this.named.keys()]);
  }
  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.named.delete(name));
  }
}
