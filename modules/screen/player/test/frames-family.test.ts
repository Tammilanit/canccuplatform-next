// @vitest-environment happy-dom
// The device frames as one family with the Pulse (#385, sheet 9 of docs/design): Pulse's header on
// every frame, packages/ui's safety classes for the pairing code and the offline marker, and only
// pages that exist.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_AFTER_MS, Player } from "../src/player.js";
import { FakeApi, fakeNav, json, problem, screenState } from "./fake.js";

const T0 = Date.parse("2026-03-14T18:42:00Z");

function setup(api: FakeApi) {
  document.body.replaceChildren();
  document.body.className = "canccu-page canccu-surface canccu-surface--screen";
  return new Player({ fetch: api.fetch, nav: fakeNav(""), root: document.body, bundle: "0.4.0" });
}
const settle = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};
const part = (cls: string): string | undefined =>
  document.querySelector(`.canccu-frame__${cls}`)?.textContent ?? undefined;
/** packages/ui's rule for a safety element: a child of the page, after the rest, text only. */
function holdsAsSafety(cls: string): void {
  const node = document.querySelector(`.${cls}`);
  expect(node?.parentElement).toBe(document.body);
  expect(document.body.lastElementChild).toBe(node);
  expect(node?.children).toHaveLength(0);
}

const pairing = () =>
  new FakeApi()
    .on("GET /api/screen/device/state", () => problem(401, "device_unknown"))
    .on("GET /api/tenants/current", () =>
      json(200, { id: "alpha", name: "Demo Event", time_zone: "UTC" }),
    )
    .on("POST /api/screen/pairing", () =>
      json(201, {
        pairing_id: "pr_1",
        code: "K7Q49WXP",
        expires_at: new Date(T0 + 581_000).toISOString(),
      }),
    )
    .on("GET /api/screen/pairing/pr_1", () => json(200, { status: "waiting" }));

describe("the device frames as one family", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the pairing code as packages/ui's safety element", async () => {
    await setup(pairing()).start();
    await settle();
    expect(document.querySelector(".canccu-pairing-code")?.textContent).toBe("K7Q4 9WXP");
    holdsAsSafety("canccu-pairing-code");
  });

  it("sends no one to a page that does not exist yet: no pair dialog QR, no Screen studio", async () => {
    await setup(pairing()).start();
    await settle();
    expect(document.querySelector(".canccu-qr")).toBeNull();
    expect(document.body.textContent).not.toContain("Screen studio");
    expect(document.body.textContent).toContain("Ask an organiser to pair it with this code.");
  });

  it("heads a frame as the Pulse does: the event, where, the date and the clock", async () => {
    const api = new FakeApi().on("GET /api/screen/device/state", () =>
      json(200, {
        ...screenState({ zone: null, time: new Date(T0).toISOString() }),
        theme: { revision: 2, tokens_css_url: null, css_url: null, logo_url: "/l.svg" },
      }),
    );
    await setup(api).start();
    await settle();
    expect(document.querySelector(".canccu-frame__logo")?.getAttribute("src")).toBe("/l.svg");
    expect(part("event")).toBe("Demo Event");
    expect(part("where")).toBe("Hall left");
    expect(part("date")).toBe("Sat 14 Mar");
    expect(part("clock")).toBe("18:42");
    expect(part("title")).toBe("Hall left");
    expect(part("lead")).toBe("Paired. Waiting for a zone.");
    expect(document.body.textContent).not.toContain("Screen studio");
    await settle(60_000);
    expect(part("clock")).toBe("18:43");
  });

  it("names the screen's setup while pairing, beside the event", async () => {
    await setup(pairing()).start();
    await settle();
    expect(part("event")).toBe("Demo Event");
    expect(part("where")).toBe("Screen setup");
    expect(part("kicker")).toBe("New screen");
    expect(part("clock")).toBe("18:42");
  });

  it("keeps the offline marker as packages/ui's safety element, also under an identify card", async () => {
    const api = new FakeApi().on("GET /api/screen/device/state", () => json(200, screenState()));
    const player = setup(api);
    await player.start();
    await settle();
    api.streamAnswer = () => Promise.reject(new TypeError("offline"));
    api.dropStream();
    await settle(OFFLINE_AFTER_MS);
    expect(document.querySelector(".canccu-offline-marker")?.textContent).toBe(
      "offline since 18:42",
    );
    holdsAsSafety("canccu-offline-marker");
  });

  it("identifies the screen by its zone and its real version", async () => {
    const api = new FakeApi().on("GET /api/screen/device/state", () => json(200, screenState()));
    const player = setup(api);
    await player.start();
    await settle();
    api.send("command", { command: "identify", expires_at: new Date(T0 + 60_000).toISOString() });
    await settle();
    expect(document.querySelector(".canccu-identify__kicker")?.textContent).toBe("Identify");
    expect(document.querySelector(".canccu-identify__zone")?.textContent).toBe(
      "Main hall · version 0.4.0",
    );
    expect(document.querySelector(".canccu-identify__left")?.textContent).toBe("15 s left");
    api.streamAnswer = () => Promise.reject(new TypeError("offline"));
    api.dropStream();
    await settle(OFFLINE_AFTER_MS);
    holdsAsSafety("canccu-offline-marker");
  });

  it("words the refused, ended and unreachable states as sheet 9 does", async () => {
    const answers = [
      problem(403, "venue_ip_refused"),
      problem(409, "event_archived"),
      json(503, {}),
    ];
    const titles: (string | undefined)[] = [];
    for (const answer of answers) {
      const api = new FakeApi().on("GET /api/screen/device/state", () => answer.clone());
      await setup(api).start();
      await settle();
      titles.push(part("title"));
    }
    expect(titles).toEqual(["Not at the venue", "This event has ended", "No connection yet"]);
  });
});
