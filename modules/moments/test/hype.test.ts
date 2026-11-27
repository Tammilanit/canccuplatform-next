/**
 * The hype curve (#787 D12, D13; contracts/moments.md, The hype): a zone's level and phase from its
 * big items on the shared case file Screen's tests read too, and the band rule that lets the level
 * a screen draws change at most once in 5 minutes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { heldHype, hypeOf } from "../src/hype.js";
import type { Hype } from "../src/hype.js";
import type { AgendaItem } from "../src/scene-eval.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../../contracts/moments/hype.json", import.meta.url), "utf8"),
) as {
  items: AgendaItem[];
  cases: { zone: string; at: string; hype: { level: number; phase: string; item: string | null } }[];
};

const MIN = 60_000;
const at = (iso: string): number => Date.parse(iso);

describe("the hype", () => {
  it("is quiet far away, builds over the hour before, holds while live and falls after", () => {
    for (const c of fixture.cases) {
      const h = hypeOf(fixture.items, c.zone, at(c.at));
      expect({ level: h.level, phase: h.phase, item: h.item?.id ?? null }, `${c.zone} ${c.at}`).toEqual(
        c.hype,
      );
    }
  });

  it("names the item it builds towards with its title, kind and times", () => {
    expect(hypeOf(fixture.items, "main", at("2026-03-13T17:30:00Z")).item).toEqual({
      id: "ai_cup",
      title: "Demo Cup",
      kind: "tournament",
      starts_at: "2026-03-13T18:00:00Z",
      ends_at: "2026-03-13T20:00:00Z",
    });
  });

  it("counts only public, scheduled tournaments and ceremonies of the zone or of no zone", () => {
    const h = hypeOf(fixture.items, "lobby", at("2026-03-13T12:30:00Z"));
    expect(h).toEqual({ level: 0, phase: "quiet", item: null });
  });
});

describe("the band rule", () => {
  const sent = (level: number, phase: Hype["phase"], since: number) => ({
    hype: { level, phase, item: null },
    band_since: since,
  });
  const T = at("2026-03-13T17:00:00Z");

  it("lets the first hype through as it is, its band from now", () => {
    expect(heldHype(null, { level: 0.5, phase: "building", item: null }, T)).toEqual({
      hype: { level: 0.5, phase: "building", item: null },
      band_since: T,
    });
  });

  it("moves within a band at once and keeps the band's start", () => {
    const next = heldHype(sent(0.4, "building", T), { level: 0.6, phase: "building", item: null }, T + MIN);
    expect(next).toEqual(sent(0.6, "building", T));
  });

  it("holds a new band back at the old band's edge until 5 minutes have passed", () => {
    const up = heldHype(sent(0.4, "building", T), { level: 0.75, phase: "building", item: null }, T + 4 * MIN);
    expect(up).toEqual(sent(0.65, "building", T));
    const down = heldHype(sent(0.75, "live", T), { level: 0.5, phase: "after", item: null }, T + 2 * MIN);
    expect(down).toEqual(sent(0.7, "after", T));
    const quiet = heldHype(sent(0.5, "after", T), { level: 0.1, phase: "after", item: null }, T + MIN);
    expect(quiet).toEqual(sent(0.35, "after", T));
  });

  it("lets the new band through after 5 minutes, its start from now", () => {
    const next = heldHype(sent(0.4, "building", T), { level: 0.75, phase: "building", item: null }, T + 5 * MIN);
    expect(next).toEqual(sent(0.75, "building", T + 5 * MIN));
  });
});
