import { describe, expect, it } from "vitest";
import { percentile, report, soakVerdict } from "./stack/measure.mjs";
import type { SoakSample } from "./stack/measure.mjs";

const MIB = 1024 * 1024;

function samples(heapsMib: number[], nodes = 400, listeners = 60): SoakSample[] {
  return heapsMib.map((heap, hour) => ({ hour, heap: heap * MIB, nodes, listeners }));
}

describe("percentile", () => {
  it("answers the nearest rank, whatever the order", () => {
    const values = Array.from({ length: 20 }, (_, i) => 20 - i);
    expect(percentile(values, 0.95)).toBe(19);
    expect(percentile(values, 0.5)).toBe(10);
    expect(percentile([7], 0.95)).toBe(7);
  });

  it("is NaN for no values, which no budget passes", () => {
    expect(percentile([], 0.95)).toBeNaN();
  });
});

describe("soakVerdict", () => {
  it("passes a heap that settles after the warm-up hour", () => {
    const v = soakVerdict(samples([3, 9, 9.5, 9.2, 9.8, 9.4, 9.6, 9.3]), { heapGrowth: 8 * MIB });
    expect(v.ok).toBe(true);
    expect(v.reasons).toEqual([]);
  });

  it("fails a heap that keeps growing past the budget", () => {
    const v = soakVerdict(samples([3, 4, 6, 9, 12, 15, 18, 21]), { heapGrowth: 8 * MIB });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/heap grew/);
  });

  it("does not fail on one high sample at the end, only on what stays", () => {
    const v = soakVerdict(samples([3, 9, 9, 9, 9, 30, 9.5]), { heapGrowth: 8 * MIB });
    expect(v.ok).toBe(true);
  });

  it("fails DOM nodes or listeners that pile up", () => {
    const grown = samples([3, 9, 9, 9, 9, 9, 9]).map((s, i) => ({ ...s, nodes: 400 + i * 400 }));
    const v = soakVerdict(grown, { heapGrowth: 8 * MIB });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/nodes/);
  });

  it("fails a run too short to judge", () => {
    expect(soakVerdict(samples([3, 4]), { heapGrowth: 8 * MIB }).ok).toBe(false);
  });
});

describe("report", () => {
  it("names the verdict and lists every sample", () => {
    const list = samples([3, 9, 9, 9, 9]);
    const text = report(
      { title: "Soak", lines: ["mode: accelerated"] },
      list,
      soakVerdict(list, { heapGrowth: 8 * MIB }),
    );
    expect(text).toMatch(/^# Soak/);
    expect(text).toMatch(/Verdict: pass/);
    expect(text).toMatch(/mode: accelerated/);
    expect(text.match(/^\| \d+ \|/gm)).toHaveLength(5);
  });
});
