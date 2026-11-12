// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { driftAt, effectiveMotion, FADE_MS } from "../src/display.js";
import { countdownText, drawWidget, fillCountdowns, liveView } from "../src/widget.js";

const view = (over: Record<string, unknown>) => ({ qr: null, stale: false, empty: false, ...over });

describe("a widget on the screen", () => {
  it("carries its type, and the empty and stale states as the stable classes", () => {
    const w = drawWidget("ticker", null, view({ text: "Hi" }), []);
    expect(w.className).toBe("canccu-widget canccu-widget--ticker");
    expect(w.querySelector(".canccu-widget__line")?.textContent).toBe("Hi");
    const gone = drawWidget("agenda_now", null, view({ empty: true, stale: true }), []);
    expect(gone.classList.contains("canccu-is-empty")).toBe(true);
    expect(gone.classList.contains("canccu-is-stale")).toBe(true);
  });

  it("draws with the theme's template when it has one for the type", () => {
    const theirs = [{ name: "clock", widget: "clock", tree: [{ field: "time" }, { text: "!" }] }];
    expect(drawWidget("clock", null, view({ time: "18:42" }), theirs).textContent).toBe("18:42!");
  });

  it("draws a type it has no template for as an empty widget, never an error", () => {
    const w = drawWidget("playlist", null, view({ empty: true }), []);
    expect(w.childNodes.length).toBe(0);
    expect(w.classList.contains("canccu-widget--playlist")).toBe(true);
  });
});

describe("what ticks on the device", () => {
  const at = Date.parse("2026-03-14T18:42:30Z");

  it("keeps the clock's fields current in the event's time zone", () => {
    const clock = liveView(
      "clock",
      view({ iso: "x", time: "00:00", date: "y" }),
      at,
      "Europe/Helsinki",
    );
    expect(clock).toMatchObject({
      iso: "2026-03-14T18:42:00.000Z",
      time: "20:42",
      date: "Sat 14 Mar",
    });
    const other = view({ title: "t" });
    expect(liveView("agenda_now", other, at, "UTC")).toBe(other);
  });

  it("counts down to a time: hours, minutes and seconds, never below zero", () => {
    expect(countdownText(Date.parse("2026-03-14T19:30:00Z") - at)).toBe("00:47:30");
    expect(countdownText(26 * 3600_000 + 1)).toBe("26:00:01");
    expect(countdownText(-5000)).toBe("00:00:00");
  });

  it("fills every empty <time datetime> with the time left, and keeps it counting", () => {
    const box = document.createElement("div");
    box.innerHTML =
      '<time datetime="2026-03-14T19:30:00Z"></time><time datetime="2026-03-14T19:30:00Z">19:30</time><time datetime="junk"></time>';
    fillCountdowns(box, at);
    const [left, fixed, junk] = [...box.querySelectorAll("time")];
    expect(left?.textContent).toBe("00:47:30");
    expect(fixed?.textContent).toBe("19:30");
    expect(junk?.textContent).toBe("");
    fillCountdowns(box, at + 1000);
    expect(left?.textContent).toBe("00:47:29");
  });
});

describe("how the screen moves", () => {
  it("lowers the zone's motion to none under reduced motion, and never raises it", () => {
    expect(effectiveMotion("moderate", false)).toBe("moderate");
    expect(effectiveMotion("calm", false)).toBe("calm");
    expect(effectiveMotion("moderate", true)).toBe("none");
    expect(effectiveMotion(undefined, false)).toBe("moderate");
    expect(effectiveMotion("wild", false)).toBe("moderate");
    expect(FADE_MS.none).toBe(0);
    expect(FADE_MS.calm).toBeGreaterThan(FADE_MS.moderate);
  });

  it("drifts one step a minute round a circle in an hour, the same on every screen", () => {
    const hour = Date.parse("2026-03-14T18:00:00Z");
    expect(driftAt(hour)).toEqual({ x: 1, y: 0 });
    expect(driftAt(hour + 59_999)).toEqual({ x: 1, y: 0 });
    const quarter = driftAt(hour + 15 * 60_000);
    expect(quarter.x).toBeCloseTo(0);
    expect(quarter.y).toBeCloseTo(1);
    expect(driftAt(hour + 30 * 60_000).x).toBeCloseTo(-1);
  });
});
