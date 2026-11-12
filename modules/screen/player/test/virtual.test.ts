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
const ZONE_STREAM = "/api/screen/zones/main/stream";
const mirror = { id: "mirror", name: "Main hall", mirror: true };

/** The zone's own stream, open, as the fake API's device stream is. */
const streaming = (api: FakeApi): FakeApi => api.on(`GET ${ZONE_STREAM}`, () => api.openStream());

const ticker = (id: string, text: string, column: number) => ({
  id,
  role: "ticker",
  area: { column, row: 1, columns: 1, rows: 1 },
  layer: 0,
  rotation: "sequence",
  order: [0],
  cycle_started_at: "2026-01-01T00:00:00Z",
  idle: "logo",
  idle_view: null,
  widgets: [
    { widget: "ticker", dwell_seconds: 15, view: { text, qr: null, stale: false, empty: false } },
  ],
  claim: null,
});

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
    const api = streaming(new FakeApi()).on(`GET ${ZONE_STATE}`, () =>
      json(200, screenState({ device: mirror })),
    );
    const zone = setup(api);
    await zone.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(document.body.querySelector(".canccu-layout")).not.toBeNull();
    expect(api.calls).toContain(`GET ${ZONE_STATE}`);
    expect(api.calls).toContain(`GET ${ZONE_STREAM}`);
    expect(api.calls.some((c) => c.includes("/device/"))).toBe(false);
    zone.live.stop();
  });

  it("builds each push on the one before it, and takes a pushed theme", async () => {
    const playing = screenState({
      device: mirror,
      layout: { id: "pulse", aspect: "16:9", grid: { columns: 2, rows: 1 } },
      regions: [ticker("a", "A", 1), ticker("b", "B", 2)],
    });
    const api = streaming(new FakeApi()).on(`GET ${ZONE_STATE}`, () => json(200, playing));
    const zone = setup(api);
    await zone.start();
    await vi.advanceTimersByTimeAsync(100);
    // The ticker's lines, without the "Info" label every ticker carries.
    const layout = () =>
      [...document.body.querySelectorAll(".canccu-layout .canccu-widget__line")]
        .map((l) => l.textContent)
        .join("");
    expect(layout()).toBe("AB");
    api.send("widget", { state_version: 4, region_id: "a", index: 0, view: { text: "A2" } });
    api.send("widget", { state_version: 5, region_id: "b", index: 0, view: { text: "B2" } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(layout()).toBe("A2B2");
    // happy-dom loads no stylesheet and logs the one it is asked for: only the link counts here.
    const theme = { ...playing.theme, revision: 3, tokens_css_url: "/theming/a/t3.css" };
    api.send("theme", { state_version: 6, theme });
    await vi.advanceTimersByTimeAsync(100);
    const tokens = document.head.querySelector('link[data-theme="tokens"]');
    expect(tokens?.getAttribute("href")).toBe("/theming/a/t3.css");
    expect(zone.live.state?.theme.revision).toBe(3);
    expect(layout()).toBe("A2B2");
    zone.live.stop();
  });

  it("says the zone is gone when its stream answers 404, rather than retry", async () => {
    let gone = false;
    const api = new FakeApi()
      .on(`GET ${ZONE_STATE}`, () =>
        gone ? problem(404, "not_found") : json(200, screenState({ device: mirror })),
      )
      .on(`GET ${ZONE_STREAM}`, () => (gone ? problem(404, "not_found") : api.openStream()));
    const zone = setup(api);
    await zone.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(document.body.querySelector(".canccu-layout")).not.toBeNull();
    gone = true;
    api.dropStream();
    await vi.advanceTimersByTimeAsync(5000);
    expect(frameText()).toBe("No such zone");
    expect(zone.live.running).toBe(false);
    expect(document.body.querySelector(".canccu-offline-marker")).toBeNull();
    const connects = api.calls.filter((c) => c === `GET ${ZONE_STREAM}`).length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.calls.filter((c) => c === `GET ${ZONE_STREAM}`)).toHaveLength(connects);
  });

  it("asks for a portrait screen's state when the page stands for one", async () => {
    const api = new FakeApi().on(`GET ${ZONE_STATE}?orientation=portrait`, () =>
      json(200, screenState({ device: mirror })),
    );
    const zone = setup(api, true);
    await zone.start();
    expect(api.calls).toContain(`GET ${ZONE_STREAM}?orientation=portrait`);
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
      expect(api.calls).not.toContain(`GET ${ZONE_STREAM}`);
    });
  }

  it("retries while the server does not answer", async () => {
    let up = false;
    const api = streaming(new FakeApi()).on(`GET ${ZONE_STATE}`, () =>
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
    const api = streaming(new FakeApi()).on(`GET ${ZONE_STATE}`, () =>
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
