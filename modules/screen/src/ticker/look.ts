/**
 * How the ticker looks and moves, from the event's settings (contracts/screen.md, Ticker and
 * Settings): its appearance, and its speed in pixels a second of a 1080p screen, which the player
 * scales to its own (#779). `ticker_pixels_per_second` wins over the `ticker_speed` choice when
 * it is set; a value admin would refuse reads as the default, so a screen always moves.
 */
import type { Settings } from "../health.js";

const APPEARANCES = ["default", "high_contrast", "minimal", "broadcast"];
const SPEEDS: Record<string, number> = { slow: 120, normal: 180, fast: 270 };

export type TickerLook = {
  appearance: string;
  speed: number;
};

export function tickerLook(settings: Pick<Settings, "get">): TickerLook {
  const appearance = settings.get("ticker_appearance", "default");
  const choice = settings.get("ticker_speed", "normal");
  const pixels = settings.get("ticker_pixels_per_second", 0);
  return {
    appearance:
      typeof appearance === "string" && APPEARANCES.includes(appearance) ? appearance : "default",
    speed:
      typeof pixels === "number" && Number.isInteger(pixels) && pixels > 0 && pixels <= 2000
        ? pixels
        : typeof choice === "string" && Object.hasOwn(SPEEDS, choice)
          ? (SPEEDS[choice] ?? SPEEDS.normal ?? 180)
          : 180,
  };
}
