// @vitest-environment happy-dom
/** The kiosk check page (plan #109, S14): each row says what is wrong and what fixes it. */
import { describe, expect, it } from "vitest";
import { NO_ANSWER } from "../src/api.js";
import { CheckPage, checkRows, measure } from "../src/check.js";
import type { CheckInput } from "../src/check.js";
import { FakeApi, json, problem, screenState } from "./fake.js";

const good: CheckInput = {
  viewport: { width: 1920, height: 1080, dpr: 1 },
  offsetMs: 120,
  device: { status: 200, code: null, body: screenState() },
  audio: { withoutTap: true, now: true },
  offline: { available: true, active: true },
  bundle: "1.2.3",
};

const row = (input: Partial<CheckInput>, name: string) =>
  checkRows({ ...good, ...input }).find((r) => r.name === name);

describe("the kiosk check", () => {
  it("passes a well set up kiosk", () => {
    expect(checkRows(good).every((r) => r.ok)).toBe(true);
    expect(row({}, "Device")?.value).toBe("paired as Hall left, zone Main hall");
  });

  it("takes a 4K panel at 2× and a portrait screen as 1080p or more, and flags less", () => {
    expect(row({ viewport: { width: 1920, height: 1080, dpr: 2 } }, "Screen")?.ok).toBe(true);
    expect(row({ viewport: { width: 1080, height: 1920, dpr: 1 } }, "Screen")?.value).toContain(
      "portrait",
    );
    const small = row({ viewport: { width: 1366, height: 768, dpr: 1 } }, "Screen");
    expect(small?.ok).toBe(false);
    expect(small?.value).toContain("below 1080p");
  });

  it("flags a clock more than 2 s off, and names NTP", () => {
    expect(row({ offsetMs: -1900 }, "Clock")?.ok).toBe(true);
    const off = row({ offsetMs: 2500 }, "Clock");
    expect(off?.ok).toBe(false);
    expect(off?.value).toBe(
      "+2.5 s against the server: turn on network time (NTP) on this computer",
    );
    expect(row({ offsetMs: null }, "Clock")?.ok).toBe(false);
  });

  it("names the autoplay flag while sound needs a tap", () => {
    const blocked = row({ audio: { withoutTap: false, now: false } }, "Sound");
    expect(blocked?.value).toContain("--autoplay-policy=no-user-gesture-required");
    const tapped = row({ audio: { withoutTap: false, now: true } }, "Sound");
    expect(tapped?.ok).toBe(false);
    expect(tapped?.value).toContain("this page only");
  });

  it("says why the device does not play", () => {
    const answer = (status: number) => ({ ...NO_ANSWER, status });
    expect(row({ device: answer(401) }, "Device")?.value).toContain("not paired");
    expect(row({ device: answer(403) }, "Device")?.value).toContain("not the event's venue");
    expect(row({ device: NO_ANSWER }, "Device")?.value).toBe("the server did not answer");
    const unassigned = { status: 200, code: null, body: screenState({ zone: null }) };
    expect(row({ device: unassigned }, "Device")?.ok).toBe(false);
    expect(row({ offline: { available: false, active: false } }, "Offline")?.value).toContain(
      "https://",
    );
  });

  it("measures the clock against the state's time, else the Date header", async () => {
    let t = 1_000_000;
    const now = () => (t += 100);
    const state = screenState({ time: new Date(1_005_150).toISOString() });
    const api = new FakeApi().on("GET /api/screen/device/state", () => json(200, state));
    expect((await measure(api.fetch, now)).offsetMs).toBe(5000);
    const unpaired = new FakeApi().on("GET /api/screen/device/state", () => {
      const r = problem(401, "device_unknown");
      r.headers.set("date", new Date(1_010_150).toUTCString());
      return r;
    });
    t = 1_000_000;
    // The header has whole seconds only: 1_010_000 against the midpoint 1_000_150.
    expect((await measure(unpaired.fetch, now)).offsetMs).toBe(9850);
  });

  it("draws its rows and a sound test button", async () => {
    const api = new FakeApi().on("GET /api/screen/device/state", () => json(200, screenState()));
    document.body.replaceChildren();
    await new CheckPage({
      fetch: api.fetch,
      root: document.body,
      bundle: "1.2.3",
      viewport: () => good.viewport,
      offline: () => good.offline,
    }).start();
    const names = [...document.querySelectorAll(".canccu-check__name")].map((n) => n.textContent);
    expect(names).toEqual(["Screen", "Clock", "Device", "Sound", "Offline", "Player"]);
    expect(document.querySelector("button.canccu-check__unlock")).not.toBeNull();
  });
});
