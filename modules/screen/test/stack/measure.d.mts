// Types for measure.mjs, which runs as plain JavaScript inside the stack's containers.
export interface SoakSample {
  /** Hours of the page's own clock since the start. */
  hour: number;
  /** JS heap in use after a forced GC, in bytes. */
  heap: number;
  nodes: number;
  listeners: number;
}
export interface SoakVerdict {
  ok: boolean;
  reasons: string[];
  baseline?: Omit<SoakSample, "hour">;
  last?: Omit<SoakSample, "hour">;
  growth?: number;
}
export function percentile(values: number[], p: number): number;
export function soakVerdict(samples: SoakSample[], budget: { heapGrowth: number }): SoakVerdict;
export function report(
  meta: { title: string; lines: string[] },
  samples: SoakSample[],
  verdict: SoakVerdict,
): string;
