// The numbers the stack tests judge by: latency percentiles (load) and the soak's memory verdict
// and report. Pure, so test/stack-measure.test.ts holds them without a stack or a browser.

/** The nearest-rank percentile `p` (0–1) of `values`; NaN for none, which no budget passes. */
export function percentile(values, p) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

const WINDOW = 3;

/**
 * Whether the page's memory held over the run. Sample 0 is taken before the first hour's
 * warm-up (caches, the first state, fonts) and is not judged. The baseline is the lowest of the
 * next three samples and the end the lowest of the last three, each after a forced GC: what a leak
 * keeps stays in every sample, while one sample caught mid-render does not count.
 */
export function soakVerdict(samples, budget) {
  const reasons = [];
  if (samples.length < 2 + WINDOW) {
    return { ok: false, reasons: [`too short to judge: ${samples.length} samples`] };
  }
  const lowest = (list) =>
    Object.fromEntries(
      ["heap", "nodes", "listeners"].map((k) => [k, Math.min(...list.map((s) => s[k]))]),
    );
  const baseline = lowest(samples.slice(1, 1 + WINDOW));
  const last = lowest(samples.slice(-WINDOW));
  const growth = last.heap - baseline.heap;
  if (growth > budget.heapGrowth) {
    reasons.push(`heap grew ${mib(growth)} MiB, budget ${mib(budget.heapGrowth)} MiB`);
  }
  // A page that keeps its DOM while the layout stays has about the same number of nodes and
  // listeners all day; twice the baseline (with room for a small page) means something piles up.
  for (const key of ["nodes", "listeners"]) {
    if (last[key] > 2 * baseline[key] + 100) {
      reasons.push(`${key} grew from ${baseline[key]} to ${last[key]}`);
    }
  }
  return { ok: reasons.length === 0, reasons, baseline, last, growth };
}

const mib = (bytes) => (bytes / (1024 * 1024)).toFixed(1);

/** The run's report in Markdown: what ran, the verdict, and every sample. */
export function report(meta, samples, verdict) {
  const lines = [
    `# ${meta.title}`,
    "",
    ...meta.lines.map((l) => `- ${l}`),
    "",
    `Verdict: ${verdict.ok ? "pass" : "FAIL"}`,
    ...verdict.reasons.map((r) => `- ${r}`),
    "",
  ];
  if (verdict.baseline !== undefined) {
    lines.push(
      `Heap after GC: baseline ${mib(verdict.baseline.heap)} MiB, end ${mib(verdict.last.heap)} MiB.`,
      "",
    );
  }
  lines.push("| hour | heap MiB | DOM nodes | listeners |", "|---:|---:|---:|---:|");
  for (const s of samples)
    lines.push(`| ${s.hour} | ${mib(s.heap)} | ${s.nodes} | ${s.listeners} |`);
  return `${lines.join("\n")}\n`;
}
