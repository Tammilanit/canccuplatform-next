// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALL_TIMEOUT_MS } from "../src/api.js";
import { MOVE_MS, OFFLINE_AFTER_MS, Player, RETRY_MS } from "../src/player.js";
import { FakeApi, fakeNav, json, problem, screenState } from "./fake.js";

const T0 = Date.parse("2026-01-01T18:40:00Z");

function setup(api: FakeApi, hash = "") {
  document.body.replaceChildren();
  document.body.className = "canccu-page canccu-surface canccu-surface--screen";
  const nav = fakeNav(hash);
  const player = new Player({ fetch: api.fetch, nav, root: document.body, bundle: "1.0.0" });
  return { player, nav };
}

/** The frame on screen, or `playing` while a zone's layout is drawn. */
const shown = (): string | undefined =>
  document.body.querySelector(".canccu-layout") === null
    ? document.body.querySelector<HTMLElement>(".canccu-frame")?.dataset.frame
    : "playing";
const text = (): string => document.body.textContent;
const settle = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe("the device-state frames", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pairs a screen without a device: the code, the pair dialog's QR, then the state", async () => {
    let claimed = false;
    const api = new FakeApi()
      .on("GET /api/screen/device/state", () =>
        claimed ? json(200, screenState({ zone: null })) : problem(401, "device_unknown"),
      )
      .on("GET /api/tenants/current", () => json(200, { id: "alpha", name: "Demo Event" }))
      .on("POST /api/screen/pairing", () =>
        json(201, {
          pairing_id: "pr_1",
          code: "K7Q49WXP",
          expires_at: new Date(T0 + 581_000).toISOString(),
          poll_seconds: 2,
        }),
      )
      .on("GET /api/screen/pairing/pr_1", () =>
        json(200, claimed ? { status: "paired" } : { status: "waiting" }),
      );
    const { player } = setup(api);
    await player.start();
    await settle();
    expect(shown()).toBe("pairing");
    expect(text()).toContain("Demo Event · screen setup");
    expect(text()).toContain("K7Q4 9WXP");
    expect(text()).toContain("Code expires in 9:41");
    const qr = document.querySelector("svg.canccu-qr path");
    expect(qr?.getAttribute("d")).toMatch(/^M4 4h1v1h-1z/);
    await settle(2000);
    expect(api.calls).toContain("GET /api/screen/pairing/pr_1");
    claimed = true;
    await settle(2000);
    expect(shown()).toBe("unassigned");
    expect(text()).toContain("Hall left");
    expect(text()).toContain("Paired. Not assigned to a zone yet.");
    expect(api.calls).toContain("GET /api/screen/device/stream");
    await player.start();
  });

  it("asks for a new code when the old one expired", async () => {
    let codes = 0;
    const api = new FakeApi()
      .on("GET /api/screen/device/state", () => problem(401, "device_unknown"))
      .on("POST /api/screen/pairing", () => {
        codes += 1;
        return json(201, { pairing_id: "pr_1", code: "AAAABBBB", expires_at: "", poll_seconds: 2 });
      })
      .on("GET /api/screen/pairing/pr_1", () => json(200, { status: "expired" }));
    const { player } = setup(api);
    await player.start();
    await settle(2000);
    expect(codes).toBe(2);
  });

  it.each([
    [problem(409, "no_venue"), "This event has no venue yet"],
    [problem(429, "rate_limited"), "Too many open pairing codes"],
  ])("says why pairing cannot start (%#)", async (answer, title) => {
    const api = new FakeApi()
      .on("GET /api/screen/device/state", () => problem(401, "device_unknown"))
      .on("POST /api/screen/pairing", () => answer.clone());
    const { player } = setup(api);
    await player.start();
    await settle();
    expect(text()).toContain(title);
    await settle(RETRY_MS);
    expect(api.calls.filter((c) => c === "POST /api/screen/pairing")).toHaveLength(2);
  });

  it("shows the refused frame from outside the venue and asks again every 30 s", async () => {
    const api = new FakeApi().on("GET /api/screen/device/state", () =>
      problem(403, "venue_ip_refused"),
    );
    const { player } = setup(api);
    await player.start();
    expect(shown()).toBe("refused");
    expect(text()).toContain("Not at the event's venue");
    expect(text()).toContain("emergency switch");
    await settle(RETRY_MS);
    expect(api.calls.filter((c) => c === "GET /api/screen/device/state")).toHaveLength(2);
  });

  it("keeps the venue frame for the venue check: another 403 retries behind connecting", async () => {
    const api = new FakeApi().on("GET /api/screen/device/state", () =>
      problem(403, "missing_right"),
    );
    const { player } = setup(api);
    await player.start();
    expect(shown()).toBe("unknown");
    expect(text()).toContain("Connecting…");
    expect(text()).not.toContain("Not at the event's venue");
  });

  it("counts the code's time on the server's clock, not a kiosk clock that runs fast", async () => {
    // The device's clock is 9 minutes ahead of the server's, before NTP syncs.
    const server = T0 - 9 * 60_000;
    const api = new FakeApi()
      .on("GET /api/screen/device/state", () => problem(401, "device_unknown"))
      .on("GET /api/tenants/current", () => json(200, { id: "alpha", name: "Demo Event" }))
      .on("POST /api/screen/pairing", () => {
        const res = json(201, {
          pairing_id: "pr_1",
          code: "K7Q49WXP",
          expires_at: new Date(server + 600_000).toISOString(),
        });
        res.headers.set("date", new Date(server).toUTCString());
        return res;
      })
      .on("GET /api/screen/pairing/pr_1", () => json(200, { status: "waiting" }));
    const { player } = setup(api);
    await player.start();
    await settle();
    expect(text()).toContain("Code expires in 10:00");
  });

  it("shows the archived notice for an archived event, and keeps listening", async () => {
    const api = new FakeApi().on("GET /api/screen/device/state", () =>
      json(
        200,
        screenState({
          tenant: { id: "a", name: "Old Event", time_zone: "UTC", status: "archived" },
        }),
      ),
    );
    const { player } = setup(api);
    await player.start();
    expect(shown()).toBe("archived");
    expect(text()).toContain("This event has ended");
    expect(api.calls).toContain("GET /api/screen/device/stream");
  });

  it("follows a move: device/home's address after the moved frame", async () => {
    const api = new FakeApi()
      .on("GET /api/screen/device/state", () => problem(409, "device_moved"))
      .on("GET /api/screen/device/home", () =>
        json(200, { url: "https://next.test/screen/#transfer=abcdefghijklmnopqrstuvwxyz" }),
      );
    const { player, nav } = setup(api);
    await player.start();
    await settle();
    expect(shown()).toBe("moved");
    expect(text()).toContain("Taking you there");
    await settle(MOVE_MS);
    expect(nav.went).toEqual(["https://next.test/screen/#transfer=abcdefghijklmnopqrstuvwxyz"]);
  });

  it("a parked device shows not assigned; a failed home read says ask the crew", async () => {
    let home: Response = json(200, { url: null });
    const api = new FakeApi()
      .on("GET /api/screen/device/state", () => problem(409, "device_moved"))
      .on("GET /api/screen/device/home", () => home.clone());
    const { player, nav } = setup(api);
    await player.start();
    await settle();
    expect(shown()).toBe("unassigned");
    expect(text()).toContain("Not assigned to an event");
    home = json(503, { error: { code: "unavailable", message: "x" } });
    await settle(RETRY_MS);
    expect(shown()).toBe("moved");
    expect(text()).toContain("Moved, ask the crew");
    expect(nav.went).toEqual([]);
  });

  it("redeems a transfer code only without a working cookie, and drops it from the address", async () => {
    let redeemed = false;
    const api = new FakeApi()
      .on("GET /api/screen/device/state", () =>
        redeemed ? json(200, screenState()) : problem(401, "device_unknown"),
      )
      .on("POST /api/screen/device/transfer", (init) => {
        expect(JSON.parse(init?.body as string)).toEqual({ code: "abcdefghijklmnopqrstuvwxyz" });
        redeemed = true;
        return json(200, { device: {} });
      });
    const { player, nav } = setup(api, "#transfer=abcdefghijklmnopqrstuvwxyz");
    await player.start();
    expect(nav.hashValue).toBe("");
    expect(shown()).toBe("playing");

    const working = new FakeApi().on("GET /api/screen/device/state", () =>
      json(200, screenState()),
    );
    const second = setup(working, "#transfer=abcdefghijklmnopqrstuvwxyz");
    await second.player.start();
    expect(working.calls).not.toContain("POST /api/screen/device/transfer");
    expect(second.nav.hashValue).toBe("");
  });

  it("retries behind a connecting frame when the server does not answer", async () => {
    let up = false;
    const api = new FakeApi().on("GET /api/screen/device/state", () =>
      up ? json(200, screenState()) : problem(502, "bad_gateway"),
    );
    const { player } = setup(api);
    await player.start();
    expect(shown()).toBe("unknown");
    expect(text()).toContain("Connecting…");
    up = true;
    await settle(2000);
    expect(shown()).toBe("playing");
  });

  it("is never blank while the first read hangs, and retries once it times out", async () => {
    let up = false;
    const api = new FakeApi().on("GET /api/screen/device/state", () =>
      up ? json(200, screenState()) : new Promise<Response>(() => undefined),
    );
    const { player } = setup(api);
    void player.start();
    await settle();
    expect(shown()).toBe("unknown");
    expect(text()).toContain("Connecting…");
    await settle(CALL_TIMEOUT_MS);
    expect(text()).toContain("Trying again in");
    up = true;
    await settle(2000);
    expect(shown()).toBe("playing");
  });
});

describe("while playing", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks the page offline 10 s after the stream is lost, and clears it when it is back", async () => {
    const api = new FakeApi().on("GET /api/screen/device/state", () => json(200, screenState()));
    const { player } = setup(api);
    await player.start();
    await settle();
    api.streamAnswer = () => Promise.reject(new TypeError("offline"));
    api.dropStream();
    await settle(OFFLINE_AFTER_MS - 1);
    expect(document.body.classList.contains("canccu-is-offline")).toBe(false);
    await settle(1);
    expect(document.body.classList.contains("canccu-is-offline")).toBe(true);
    expect(document.querySelector(".canccu-offline-mark")?.textContent).toBe("offline since 18:40");
    expect(shown()).toBe("playing");
    api.streamAnswer = () => api.openStream();
    await settle(30_000);
    expect(document.body.classList.contains("canccu-is-offline")).toBe(false);
    expect(document.querySelector(".canccu-offline-mark")).toBeNull();
  });

  it("polls the state every 10 s after three failed connects", async () => {
    const api = new FakeApi().on("GET /api/screen/device/state", () => json(200, screenState()));
    api.streamAnswer = () => Promise.reject(new TypeError("offline"));
    const { player } = setup(api);
    await player.start();
    // Connects at 0, 2 s and 6 s fail; polling starts with the third.
    await settle(6000);
    const reads = () => api.calls.filter((c) => c === "GET /api/screen/device/state").length;
    expect(reads()).toBe(1);
    await settle(10_000);
    expect(reads()).toBe(2);
  });

  it("applies pushes, draws a new state and leaves for the moved flow when the stream says so", async () => {
    const api = new FakeApi()
      .on("GET /api/screen/device/state", () => json(200, screenState()))
      .on("GET /api/screen/device/home", () => json(200, { url: "https://next.test/screen/" }));
    const { player, nav } = setup(api);
    await player.start();
    await settle();
    api.send("ticker", { state_version: 4, ticker: { text: "Hello" } }, "main.e1.4");
    await settle();
    expect(player.state?.state_version).toBe(4);
    expect(player.state?.ticker).toEqual({ text: "Hello" });
    api.send("state", screenState({ state_version: 5, zone: null }), "none.0.5");
    await settle();
    expect(shown()).toBe("unassigned");
    api.streamAnswer = () => problem(409, "device_moved");
    api.dropStream();
    await settle(2000);
    expect(shown()).toBe("moved");
    await settle(MOVE_MS);
    expect(nav.went).toEqual(["https://next.test/screen/"]);
  });

  it("draws the zone's layout and keeps it while pushes change what it shows", async () => {
    const ticker = (text: string) => ({
      id: "ticker",
      role: "ticker",
      area: { column: 1, row: 1, columns: 1, rows: 1 },
      layer: 0,
      rotation: "sequence",
      order: [0],
      cycle_started_at: "2026-01-01T00:00:00Z",
      idle: "logo",
      idle_view: null,
      widgets: [
        {
          widget: "ticker",
          dwell_seconds: 15,
          view: { text, qr: null, stale: false, empty: false },
        },
      ],
      claim: null,
    });
    const playing = screenState({
      layout: { id: "pulse", aspect: "16:9", grid: { columns: 1, rows: 1 } },
      regions: [ticker("Hello")],
    });
    const api = new FakeApi().on("GET /api/screen/device/state", () => json(200, playing));
    const layout = () => document.body.querySelector(".canccu-layout");
    const { player } = setup(api);
    await player.start();
    await settle();
    const first = layout();
    expect(first?.textContent).toBe("Hello");
    api.send("widget", { state_version: 4, region_id: "ticker", index: 0, view: { text: "Bye" } });
    await settle(2000);
    expect(layout()).toBe(first);
    expect(first?.textContent).toBe("Bye");
  });

  it("takes the server's time from the state until a heartbeat answers", async () => {
    const api = new FakeApi()
      .on("GET /api/screen/device/state", () =>
        json(200, screenState({ time: new Date(T0 + 3_600_000).toISOString() })),
      )
      .on("POST /api/screen/device/heartbeat", () => problem(503, "unavailable"));
    const { player } = setup(api);
    await player.start();
    await settle();
    expect(player.live.heartbeat.serverNow()).toBe(T0 + 3_600_000);
  });

  it("runs the identify and reload commands", async () => {
    const api = new FakeApi().on("GET /api/screen/device/state", () => json(200, screenState()));
    const { player, nav } = setup(api);
    await player.start();
    await settle();
    const expires = new Date(T0 + 60_000).toISOString();
    api.send("command", { command: "identify", expires_at: expires });
    await settle();
    expect(document.querySelector(".canccu-identify")?.textContent).toContain("Hall left");
    expect(text()).toContain("zone: Main hall · v1.0.0");
    expect(text()).toContain("identify · 15 s left");
    await settle(15_000);
    expect(document.querySelector(".canccu-identify")).toBeNull();
    api.send("command", { command: "reload", expires_at: expires });
    await settle();
    expect(nav.reloads).toBe(1);
  });
});
