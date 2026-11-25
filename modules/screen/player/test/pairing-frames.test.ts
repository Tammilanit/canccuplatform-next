// @vitest-environment happy-dom
/**
 * The guided pairing on the kiosk (#783): the QR of Studio's pair dialog beside the code, the
 * frame that says plain http cannot pair, and the test pattern Studio sends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Player } from "../src/player.js";
import { FakeApi, fakeNav, json, problem, screenState } from "./fake.js";

const T0 = Date.parse("2026-01-01T18:40:00Z");

function setup(api: FakeApi, secure = true) {
  document.body.replaceChildren();
  document.body.className = "canccu-page canccu-surface canccu-surface--screen";
  const player = new Player({
    fetch: api.fetch,
    nav: fakeNav(),
    root: document.body,
    bundle: "1.0.0",
    secure: () => secure,
  });
  return { player };
}

const pairingApi = (): FakeApi =>
  new FakeApi()
    .on("GET /api/screen/device/state", () => problem(401, "device_unknown"))
    .on("GET /api/tenants/current", () => json(200, { id: "alpha", name: "Demo Event" }))
    .on("POST /api/screen/pairing", () =>
      json(201, {
        pairing_id: "pr_1",
        code: "K7Q49WXP",
        expires_at: new Date(T0 + 581_000).toISOString(),
        poll_seconds: 2,
      }),
    )
    .on("GET /api/screen/pairing/pr_1", () => json(200, { status: "waiting" }));

const shown = (): string | undefined =>
  document.body.querySelector<HTMLElement>(".canccu-frame")?.dataset.frame;
const text = (): string => document.body.textContent;
const settle = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe("the guided pairing on the kiosk", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a QR of Studio's pair dialog with the code, on the kiosk's own address (#783)", async () => {
    const { player } = setup(pairingApi());
    await player.start();
    await settle();
    const qr = document.querySelector<HTMLElement>(".canccu-frame__qr");
    expect(qr?.dataset.url).toBe("https://alpha.test/admin/screen/devices#pair=K7Q49WXP");
    const img = qr?.querySelector("img");
    expect(img?.getAttribute("src")).toMatch(/^data:image\/svg\+xml,/);
    expect(img?.getAttribute("alt")).toBe("");
    // Beside the lines, on their right, not above them: above, it pushed them past the expiry.
    expect(qr?.parentElement?.className).toBe("canccu-frame__bottom");
    expect(qr?.previousElementSibling?.className).toBe("canccu-frame__words");
    expect(qr?.previousElementSibling?.textContent).toContain("Waiting for an organiser");
    expect(text()).toContain("Scan the QR code with a phone");
    // Typing stays the fallback, and says where.
    expect(text()).toContain("Screen studio → Devices");
  });

  it("asks for no code over plain http, and says to open the address with https (#783)", async () => {
    const api = pairingApi();
    const { player } = setup(api, false);
    await player.start();
    await settle();
    expect(shown()).toBe("insecure");
    expect(text()).toContain("This address can't pair screens");
    expect(text()).toContain("https://alpha.test/screen/");
    expect(api.calls).not.toContain("POST /api/screen/pairing");
    expect(document.querySelector(".canccu-pairing-code")).toBeNull();
  });

  it("shows a test pattern with the screen's name and size for 15 s (#783)", async () => {
    const api = new FakeApi().on("GET /api/screen/device/state", () => json(200, screenState()));
    const { player } = setup(api);
    await player.start();
    await settle();
    api.send("command", {
      command: "test_pattern",
      expires_at: new Date(T0 + 60_000).toISOString(),
    });
    await settle();
    const pattern = document.querySelector(".canccu-test-pattern");
    expect(pattern?.textContent).toContain("Hall left");
    expect(pattern?.textContent).toMatch(/\d+×\d+/);
    expect(pattern?.querySelectorAll(".canccu-test-pattern__corner")).toHaveLength(4);
    // On top of the page, under packages/ui's safety elements.
    expect(document.body.lastElementChild?.classList.contains("canccu-test-pattern")).toBe(true);
    await settle(15_000);
    expect(document.querySelector(".canccu-test-pattern")).toBeNull();
  });
});
