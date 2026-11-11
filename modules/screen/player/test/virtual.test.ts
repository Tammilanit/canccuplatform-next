// @vitest-environment happy-dom
/**
 * The virtual screen (contracts/screen.md, A zone for a session): a zone drawn for a signed-in
 * person over the zone's own paths, without a heartbeat, and a preview posted by the framing page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_MESSAGE, VirtualScreen } from "../src/virtual.js";
import { FakeApi, json, problem, screenState } from "./fake.js";

const T0 = Date.parse("2026-01-01T18:40:00Z");
const ZONE_STATE = "/api/screen/zones/main/state";
const mirror = { id: "mirror", name: "Main hall", mirror: true };

function setup(api: FakeApi, portrait = false) {
  document.body.replaceChildren();
  return new VirtualScreen({
    fetch: api.fetch,
    root: document.body,
    bundle: "1.0.0",
    zone: "main",
    portrait,
    reload: () => undefined,
    reducedMotion: () => false,
  });
}

const frameText = (): string =>
  document.body.querySelector(".canccu-frame__title")?.textContent ?? "";

describe("the virtual screen", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws the zone from its session paths and streams it, with no heartbeat", async () => {
    const api = new FakeApi().on(`GET ${ZONE_STATE}`, () =>
      json(200, screenState({ device: mirror })),
    );
    const zone = setup(api);
    await zone.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(document.body.querySelector(".canccu-layout")).not.toBeNull();
    expect(api.calls).toContain(`GET ${ZONE_STATE}`);
    expect(api.calls).toContain("GET /api/screen/zones/main/stream");
    expect(api.calls.some((c) => c.includes("/device/"))).toBe(false);
    zone.live.stop();
  });

  it("asks for a portrait screen's state when the page stands for one", async () => {
    const api = new FakeApi().on(`GET ${ZONE_STATE}?orientation=portrait`, () =>
      json(200, screenState({ device: mirror })),
    );
    const zone = setup(api, true);
    await zone.start();
    expect(api.calls).toContain("GET /api/screen/zones/main/stream?orientation=portrait");
    zone.live.stop();
  });

  for (const [status, code, title] of [
    [401, "not_signed_in", "Sign in to see this zone"],
    [403, "missing_right", "No access to this zone"],
    [404, "not_found", "No such zone"],
  ] as const) {
    it(`says what to do on ${status}`, async () => {
      const api = new FakeApi().on(`GET ${ZONE_STATE}`, () => problem(status, code));
      await setup(api).start();
      expect(frameText()).toBe(title);
      expect(api.calls).not.toContain("GET /api/screen/zones/main/stream");
    });
  }

  it("retries while the server does not answer", async () => {
    let up = false;
    const api = new FakeApi().on(`GET ${ZONE_STATE}`, () =>
      up ? json(200, screenState({ device: mirror })) : problem(502, "bad_gateway"),
    );
    const zone = setup(api);
    await zone.start();
    expect(frameText()).toBe("Connecting…");
    up = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(document.body.querySelector(".canccu-layout")).not.toBeNull();
    zone.live.stop();
  });

  it("draws a preview its framing page posts, and lets the live zone go", async () => {
    const api = new FakeApi().on(`GET ${ZONE_STATE}`, () =>
      json(200, screenState({ device: mirror })),
    );
    const zone = setup(api);
    await zone.start();
    const parent = {};
    const here = "https://alpha.test";
    const message = (source: unknown, origin: string, data: unknown): MessageEvent => {
      const event = new MessageEvent("message", { data, origin });
      Object.defineProperty(event, "source", { value: source });
      return event;
    };
    const state = screenState({
      device: { id: "preview", name: "Lobby", mirror: true },
      zone: { key: "lobby", name: "Lobby", epoch: "preview" },
    });
    // Not from the framing page, not from this origin, or not a state: ignored.
    zone.preview(message({}, here, { type: PREVIEW_MESSAGE, state }), parent, here);
    zone.preview(
      message(parent, "https://evil.test", { type: PREVIEW_MESSAGE, state }),
      parent,
      here,
    );
    zone.preview(message(parent, here, { type: PREVIEW_MESSAGE, state: {} }), parent, here);
    expect(zone.live.running).toBe(true);
    zone.preview(message(parent, here, { type: PREVIEW_MESSAGE, state }), parent, here);
    expect(zone.live.running).toBe(false);
    expect(document.body.querySelector(".canccu-layout")).not.toBeNull();
  });
});
