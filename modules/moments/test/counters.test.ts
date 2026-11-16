/** The minute and hour counts on a real Valkey (D15), with `CANCCU_VALKEY_URL`; skipped without. */
import { afterAll, describe, expect, it } from "vitest";
import { withTenant } from "@canccu/kit";
import { ValkeyCounters, soundKeys } from "../src/cues/counters.js";

const VALKEY_URL = process.env.CANCCU_VALKEY_URL;

describe.skipIf(!VALKEY_URL)("the sound counters on Valkey", () => {
  const counters = ValkeyCounters.fromUrl(VALKEY_URL ?? "");
  afterAll(async () => {
    await counters.close();
  });

  it("counts per zone and window, and expires each count after its window", async () => {
    const at = Date.parse("2026-01-01T20:00:30Z") + Math.floor(Math.random() * 1e6) * 3_600_000;
    await withTenant("countertest", async () => {
      const minute = soundKeys.minute("main", at);
      expect(await counters.incr(minute, 1500)).toBe(1);
      expect(await counters.incr(minute, 1500)).toBe(2);
      expect(
        await counters.get([minute, soundKeys.hour("main", at), soundKeys.minute("cafe", at)]),
      ).toEqual([2, 0, 0]);
      // The next minute is a fresh count.
      expect(await counters.get([soundKeys.minute("main", at + 60_000)])).toEqual([0]);
      await new Promise((r) => setTimeout(r, 1700));
      expect(await counters.get([minute])).toEqual([0]);
    });
  });
});
