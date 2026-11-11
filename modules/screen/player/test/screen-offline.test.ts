// @vitest-environment happy-dom
/**
 * The screen while offline (contracts/screen.md, Offline; mockup 16): the widgets whose content
 * the server keeps dim, the ones the device keeps itself (the clock, countdowns, the kept
 * playlist) stay at full strength, and a check-in code past its time never shows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Screen } from "../src/screen.js";
import type { Region } from "../src/state.js";
import { screenState } from "./fake.js";

const T0 = Date.parse("2026-03-14T18:00:00Z");
const at = (ms: number): string => new Date(T0 + ms).toISOString();

const widget = (type: string, view: Record<string, unknown> = {}) => ({
  widget: type,
  template: null,
  dwell_seconds: 600,
  view: { qr: null, stale: false, empty: false, ...view },
});

function region(id: string, w: ReturnType<typeof widget>): Region {
  return {
    id,
    role: id,
    area: { column: 1, row: 1, columns: 12, rows: 1 },
    layer: 0,
    rotation: "sequence",
    order: [0],
    cycle_started_at: new Date(T0).toISOString(),
    idle: "logo",
    idle_view: null,
    widgets: [w],
    claim: null,
  };
}

const draw = (screen: Screen, regions: Region[]) =>
  screen.draw(
    screenState({
      layout: { id: "pulse", aspect: "16:9", grid: { columns: 12, rows: 12 } },
      regions,
      display: { motion: "none", drift: false },
    }),
  );

const widgetIn = (screen: Screen, id: string) =>
  screen.root.querySelector<HTMLElement>(`.canccu-region--${id} > .canccu-widget`);
const stale = (screen: Screen, id: string) =>
  widgetIn(screen, id)?.classList.contains("canccu-is-stale");

let offline = false;
const host = { serverNow: () => Date.now(), reducedMotion: () => false, offline: () => offline };

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  offline = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("offline, the screen", () => {
  const regions = [
    region("header", widget("clock", { iso: "", time: "18:00", date: "" })),
    region("hero", widget("countdown", { label: "Semis", target_at: at(3600_000) })),
    region("media", widget("playlist", { empty: true })),
    region("rail", widget("agenda_now", { items: [] })),
    region("ticker", widget("ticker", { text: "Doors open" })),
  ];

  it("dims the widgets the server keeps, and leaves the clock, countdowns and playlist", async () => {
    const screen = new Screen(host);
    draw(screen, regions);
    screen.start();
    for (const id of ["header", "hero", "media", "rail", "ticker"])
      expect(stale(screen, id)).toBe(false);
    offline = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(stale(screen, "rail")).toBe(true);
    expect(stale(screen, "ticker")).toBe(true);
    for (const id of ["header", "hero", "media"]) expect(stale(screen, id)).toBe(false);
    offline = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(stale(screen, "rail")).toBe(false);
    expect(stale(screen, "ticker")).toBe(false);
    screen.stop();
  });

  // A frame redrawn as the uplink drops cannot load again: it would show the browser's error page.
  it("dims an embed without drawing its frame again", async () => {
    const screen = new Screen(host);
    draw(screen, [
      region("hero", widget("embed", { frame_url: "/theming/sandbox/3/fireworks/index.html" })),
    ]);
    screen.start();
    const frame = screen.root.querySelector("iframe");
    expect(frame).not.toBeNull();
    offline = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(stale(screen, "hero")).toBe(true);
    expect(screen.root.querySelector("iframe")).toBe(frame);
    offline = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(stale(screen, "hero")).toBe(false);
    expect(screen.root.querySelector("iframe")).toBe(frame);
    screen.stop();
  });
});

describe("the check-in QR", () => {
  const code = {
    url: "https://alpha.test/notify/check-in?p=arrival&c=abc",
    image_url: "/api/screen/qr?u=abc",
    label: "Check in",
    purpose: "arrival",
    rotates_at: at(30_000),
    valid_until: at(60_000),
  };
  const image = (screen: Screen) =>
    widgetIn(screen, "door")?.querySelector("img")?.getAttribute("src") ?? null;

  it("shows its code until the code expires, then its empty state, offline or not", async () => {
    for (const isOffline of [false, true]) {
      vi.setSystemTime(T0);
      offline = isOffline;
      const screen = new Screen(host);
      draw(screen, [region("door", widget("checkin_qr", code))]);
      screen.start();
      expect(image(screen)).toBe(code.image_url);
      await vi.advanceTimersByTimeAsync(59_000);
      expect(image(screen)).toBe(code.image_url);
      await vi.advanceTimersByTimeAsync(1000);
      expect(image(screen)).toBeNull();
      expect(widgetIn(screen, "door")?.classList.contains("canccu-is-empty")).toBe(true);
      screen.stop();
    }
  });

  it("goes by the rotation time when the code names no expiry", async () => {
    const screen = new Screen(host);
    draw(screen, [region("door", widget("checkin_qr", { ...code, valid_until: null }))]);
    screen.start();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(image(screen)).toBe(code.image_url);
    await vi.advanceTimersByTimeAsync(1000);
    expect(image(screen)).toBeNull();
    screen.stop();
  });

  it("leaves a sample without a code as it is (the virtual screen's)", () => {
    const screen = new Screen(host);
    const sample = { label: "Check in", purpose: "arrival", url: null, image_url: null };
    draw(screen, [
      region("door", widget("checkin_qr", { ...sample, rotates_at: null, valid_until: null })),
    ]);
    expect(widgetIn(screen, "door")?.classList.contains("canccu-is-empty")).toBe(false);
    expect(widgetIn(screen, "door")?.textContent).toBe("Check in");
  });
});
