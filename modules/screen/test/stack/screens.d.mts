// Types for screens.mjs, which runs as plain JavaScript in the screenshot run.
import type { storiesOff } from "./stories.mjs";

export function screenShots(run: {
  browser: unknown;
  demo: Parameters<typeof storiesOff>[0] & Record<string, unknown>;
  at: (path: string) => string;
  out: string;
  fail: (what: string) => void;
  ok: (what: string) => void;
  cookieOn: (pair: string) => unknown;
  check?: boolean;
}): Promise<void>;
