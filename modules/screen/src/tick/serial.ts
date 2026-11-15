/**
 * Main's one-second tick: every step each round, and no round while the last still runs, so a slow
 * step is never doubled up. Each step is awaited to its end, failed or not: with `Promise.all` the
 * first failure ended the round while the others still ran, and the next round overlapped them.
 */
import type { Logger } from "@canccu/kit";

export function serialTick(
  steps: Record<string, () => Promise<unknown>>,
  log: Pick<Logger, "warn">,
): () => Promise<void> {
  let ticking = false;
  return async () => {
    if (ticking) return;
    ticking = true;
    const names = Object.keys(steps);
    try {
      const results = await Promise.allSettled(
        names.map((name) => (steps[name] as () => Promise<unknown>)()),
      );
      results.forEach((r, i) => {
        if (r.status === "rejected")
          log.warn({ err: r.reason, step: names[i] }, "screen tick failed");
      });
    } finally {
      ticking = false;
    }
  };
}
