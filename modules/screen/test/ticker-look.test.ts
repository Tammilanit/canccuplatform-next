// The ticker's look, from the event's settings (#779; contracts/screen.md, Ticker, Settings): its
// appearance, and its pace in pixels a second of a 1080p screen, much faster by default than the
// 86 px a second the PO found slow at the step 5 demo.
import { describe, expect, it } from "vitest";
import type { Settings } from "../src/health.js";
import { tickerLook } from "../src/ticker/look.js";

const settings = (values: Record<string, unknown>): Pick<Settings, "get"> => ({
  get: (key, fallback) => (key in values ? values[key] : fallback) as typeof fallback,
});

describe("the ticker's look", () => {
  it("is the default look at the normal pace while the event sets nothing", () => {
    expect(tickerLook(settings({}))).toEqual({ appearance: "default", speed: 180 });
  });

  it("takes the event's appearance and its slow, normal or fast pace", () => {
    expect(tickerLook(settings({ ticker_appearance: "broadcast" })).appearance).toBe("broadcast");
    const pace = (ticker_speed: string) => tickerLook(settings({ ticker_speed })).speed;
    expect([pace("slow"), pace("normal"), pace("fast")]).toEqual([120, 180, 270]);
  });

  it("takes pixels a second over the choice when the event sets them", () => {
    const look = tickerLook(settings({ ticker_speed: "slow", ticker_pixels_per_second: 400 }));
    expect(look.speed).toBe(400);
    expect(tickerLook(settings({ ticker_pixels_per_second: 0 })).speed).toBe(180);
  });

  it("reads a value it does not know as the default", () => {
    const look = tickerLook(
      settings({ ticker_appearance: "neon", ticker_speed: "warp", ticker_pixels_per_second: "9" }),
    );
    expect(look).toEqual({ appearance: "default", speed: 180 });
  });
});
