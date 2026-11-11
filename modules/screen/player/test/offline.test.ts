// @vitest-environment happy-dom
/**
 * A cold boot without the uplink draws the last state (contracts/screen.md, Offline; brief E11),
 * marked offline since the page last heard from the server; an answer about the device still
 * wins over it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_AFTER_MS, Player } from "../src/player.js";
import { OfflineStore, SAVE_DELAY_MS } from "../src/offline.js";
import { FakeApi, FakeCaches, fakeNav, json, problem, screenState } from "./fake.js";

const T0 = Date.parse("2026-01-01T18:40:00Z");

function worker() {
  const posted: unknown[] = [];
  const register = vi.fn(() => Promise.resolve({}));
  const listeners: (() => void)[] = [];
  const container = {
    controller: { postMessage: (m: unknown) => posted.push(m) } as unknown as ServiceWorker | null,
    register,
    addEventListener: (_type: string, fn: () => void) => listeners.push(fn),
  };
  return {
    posted,
    listeners,
    register,
    container: container as unknown as ServiceWorkerContainer & typeof container,
  };
}

function store(caches = new FakeCaches(), w = worker()) {
  return new OfflineStore({
    caches: caches as unknown as CacheStorage,
    worker: w.container,
    origin: "https://alpha.test",
    now: Date.now,
  });
}

const shown = (): string | undefined =>
  document.body.querySelector(".canccu-layout") === null
    ? document.body.querySelector<HTMLElement>(".canccu-frame")?.dataset.frame
    : "playing";

describe("the offline store", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the last of a burst of states, and names its files to the worker", async () => {
    const w = worker();
    const s = store(new FakeCaches(), w);
    s.register("1.2.3");
    expect(w.register).toHaveBeenCalledWith("/screen/sw.js?v=1.2.3", {
      scope: "/screen/",
    });
    s.save(screenState({ state_version: 1 }));
    const logo = "/theming/a/logo.png";
    const theme = { ...screenState().theme, logo_url: logo };
    s.save(screenState({ state_version: 2, theme }));
    expect(await s.load()).toBeNull();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    const saved = await s.load();
    expect(saved?.state.state_version).toBe(2);
    expect(saved?.seenAt).toBe(T0 + SAVE_DELAY_MS);
    expect(w.posted).toEqual([{ type: "canccu-screen-files", files: [logo] }]);
    // A new state that names the same files costs the worker no pass.
    s.save(screenState({ state_version: 3, theme }));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(w.posted).toHaveLength(1);
    // A worker that takes control later learns the files then.
    for (const fn of w.listeners) fn();
    expect(w.posted).toHaveLength(2);
  });

  it("does nothing outside a secure context, where browsers offer no cache or worker", async () => {
    const s = new OfflineStore({ caches: undefined, worker: undefined, origin: "", now: Date.now });
    s.register("1");
    s.save(screenState());
    s.seen();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(await s.load()).toBeNull();
  });
});

describe("a cold boot", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    document.body.replaceChildren();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function boot(api: FakeApi, caches: FakeCaches) {
    const player = new Player({
      fetch: api.fetch,
      nav: fakeNav(),
      root: document.body,
      bundle: "1.0.0",
      offline: store(caches),
    });
    await player.start();
    return player;
  }

  async function keptState(caches: FakeCaches): Promise<void> {
    // A first boot with the server up keeps its state; the stream then dies with the uplink.
    const up = new FakeApi().on("GET /api/screen/device/state", () => json(200, screenState()));
    const first = await boot(up, caches);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    first.live.stop();
    vi.setSystemTime(T0 + 3 * 3600_000);
  }

  for (const [why, answer] of [
    ["no network", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a server that fails", () => problem(502, "bad_gateway")],
  ] as const) {
    it(`draws the last state with ${why}, offline since it last heard from the server`, async () => {
      const caches = new FakeCaches();
      await keptState(caches);
      const api = new FakeApi().on("GET /api/screen/device/state", answer);
      api.streamAnswer = () => Promise.reject(new TypeError("offline"));
      const player = await boot(api, caches);
      expect(shown()).toBe("playing");
      expect(player.state?.zone?.key).toBe("main");
      await vi.advanceTimersByTimeAsync(OFFLINE_AFTER_MS);
      expect(document.body.classList.contains("canccu-is-offline")).toBe(true);
      expect(document.querySelector(".canccu-offline-mark")?.textContent).toBe(
        "offline since 18:40",
      );
      player.live.stop();
    });
  }

  it("follows an answer about the device rather than the old state", async () => {
    const caches = new FakeCaches();
    await keptState(caches);
    const api = new FakeApi()
      .on("GET /api/screen/device/state", () => problem(401, "device_unknown"))
      .on("GET /api/tenants/current", () => json(200, { name: "Demo Event" }))
      .on("POST /api/screen/pairing", () =>
        json(201, { pairing_id: "pr_1", code: "AAAABBBB", expires_at: "" }),
      );
    await boot(api, caches);
    await vi.advanceTimersByTimeAsync(0);
    expect(shown()).toBe("pairing");
  });

  for (const [why, refusal] of [
    ["revoked", () => problem(401, "device_unknown")],
    ["refused by the venue", () => problem(403, "venue_ip_refused")],
    ["moved", () => problem(409, "device_moved")],
    ["archived", () => problem(409, "event_archived")],
  ] as const) {
    it(`forgets the kept state once ${why}, so a later boot without the server cannot replay it`, async () => {
      const caches = new FakeCaches();
      await keptState(caches);
      const told = new FakeApi()
        .on("GET /api/screen/device/state", refusal)
        .on("GET /api/tenants/current", () => json(200, { name: "Demo Event" }))
        .on("POST /api/screen/pairing", () =>
          json(201, { pairing_id: "pr_1", code: "AAAABBBB", expires_at: "" }),
        );
      const second = await boot(told, caches);
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
      second.live.stop();
      const down = new FakeApi().on("GET /api/screen/device/state", () =>
        Promise.reject(new TypeError("Failed to fetch")),
      );
      await boot(down, caches);
      expect(shown()).toBe("unknown");
    });
  }

  it("with nothing kept, says it is connecting, as before", async () => {
    const api = new FakeApi().on("GET /api/screen/device/state", () =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    await boot(api, new FakeCaches());
    expect(shown()).toBe("unknown");
  });
});
