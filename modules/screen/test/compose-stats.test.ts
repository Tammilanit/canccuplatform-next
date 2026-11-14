/** The Right now box's source (contracts/screen.md, `stats`, Trend arrows and Peaks). */
import { withTenant } from "@canccu/kit";
import { describe, expect, it } from "vitest";
import { MemoryKv } from "../src/kv.js";
import { noSources } from "../src/compose/sources.js";
import type { Sources } from "../src/compose/sources.js";
import {
  checkinsMoved,
  keepPresence,
  peakOf,
  presenceOf,
  readStats,
  statsView,
  trendOf,
} from "../src/compose/stats.js";
import type { PresenceCount } from "../src/compose/stats.js";

const T0 = Date.parse("2026-01-01T22:00:00Z");
const MIN = 60_000;
const at = (minutesAgo: number, online: number, inVoice = 10): PresenceCount => ({
  at: T0 - minutesAgo * MIN,
  interval_seconds: 60,
  members: 400,
  online,
  in_voice: inVoice,
});
/** One count a minute for the last `minutes`, `online` as the function says. */
const series = (minutes: number, online: (m: number) => number): PresenceCount[] =>
  Array.from({ length: minutes + 1 }, (_, i) => at(minutes - i, online(minutes - i)));
const online = (c: PresenceCount) => c.online;

describe("presenceOf", () => {
  it("reads bot.presence.counted and refuses anything else", () => {
    const data = {
      counted_at: "2026-01-01T22:00:00Z",
      interval_seconds: 60,
      members: 400,
      online: 212,
      idle: 3,
      dnd: 1,
      in_voice: 36,
    };
    expect(presenceOf(data)).toEqual({
      at: T0,
      interval_seconds: 60,
      members: 400,
      online: 212,
      in_voice: 36,
    });
    expect(presenceOf({ ...data, online: -1 })).toBeNull();
    expect(presenceOf({ ...data, counted_at: "soon" })).toBeNull();
  });
});

describe("trendOf", () => {
  it("is absent under 20 minutes of counts", () => {
    expect(
      trendOf(
        series(15, () => 100),
        online,
        T0,
      ),
    ).toBeUndefined();
  });

  it("compares the last 10 minutes with the 10 before, past 3 % and 2", () => {
    expect(
      trendOf(
        series(25, (m) => (m < 10 ? 120 : 100)),
        online,
        T0,
      ),
    ).toBe("up");
    expect(
      trendOf(
        series(25, (m) => (m < 10 ? 80 : 100)),
        online,
        T0,
      ),
    ).toBe("down");
    // 2 % of 100 is no turn, and neither is a change of 1 on a small count.
    expect(
      trendOf(
        series(25, (m) => (m < 10 ? 102 : 100)),
        online,
        T0,
      ),
    ).toBe("flat");
    expect(
      trendOf(
        series(25, (m) => (m < 10 ? 11 : 10)),
        online,
        T0,
      ),
    ).toBe("flat");
  });

  it("reads on the whole minute, so an arrow holds at least 60 s", () => {
    const counts = [...series(25, () => 100), { ...at(0, 200), at: T0 + 30_000 }];
    expect(trendOf(counts, online, T0 + 59_000)).toBe("flat");
  });
});

describe("peakOf", () => {
  it("is the highest count and when it was first reached, in the event's time zone", () => {
    const counts = [at(120, 200), at(90, 231), at(60, 231), at(30, 150)];
    expect(peakOf(counts, online, "Europe/Helsinki")).toEqual({
      count: 231,
      at: new Date(T0 - 90 * MIN).toISOString(),
      time_text: "22:30",
    });
    expect(peakOf([], online, "UTC")).toBeUndefined();
  });
});

describe("statsView", () => {
  it("is null with nothing counted and no check-ins read", () => {
    expect(statsView([], null, "UTC", T0)).toBeNull();
  });

  it("shows only `checked_in` while the bot counts nothing", () => {
    expect(statsView([], 164, "UTC", T0)).toEqual({ checked_in: 164 });
  });

  it("shows the latest counts with trends and peaks while they are live", () => {
    const view = statsView(
      series(25, (m) => (m < 10 ? 218 : 190)),
      164,
      "UTC",
      T0,
    );
    expect(view).toMatchObject({
      members: 400,
      online: 218,
      in_voice: 10,
      online_trend: "up",
      in_voice_trend: "flat",
      members_trend: "flat",
      checked_in: 164,
      online_peak: { count: 218, time_text: "21:51" },
      in_voice_peak: { count: 10, time_text: "21:35" },
    });
  });

  it("leaves the counts out once the bot has gone quiet for three intervals", () => {
    expect(statsView([at(4, 200)], null, "UTC", T0)).toBeNull();
  });
});

describe("readStats", () => {
  const sources = (counts: (number | null)[]): Sources & { reads: number } => {
    const s = {
      ...noSources,
      reads: 0,
      checkinCount: () => {
        s.reads += 1;
        return Promise.resolve(counts[s.reads - 1] ?? null);
      },
    };
    return s;
  };

  it("keeps the bot's counts for 24 hours, read in the event's context", async () => {
    const kv = new MemoryKv(() => T0);
    await keepPresence(kv, "alpha", at(1, 212));
    await keepPresence(kv, "alpha", at(1, 212));
    await keepPresence(kv, "beta", at(1, 5));
    const read = await withTenant("alpha", () => readStats(kv, noSources, "alpha", "UTC", T0));
    expect(read.view).toMatchObject({ online: 212, online_peak: { count: 212 } });
    const later = T0 + 24 * 3_600_000;
    const gone = await withTenant("alpha", () => readStats(kv, noSources, "alpha", "UTC", later));
    expect(gone.view).toBeNull();
  });

  it("reads the check-ins at the first build and after a check-in, at most every 10 s", async () => {
    const kv = new MemoryKv(() => T0);
    const notify = sources([3, 4, 5]);
    const read = (now: number) =>
      withTenant("alpha", () => readStats(kv, notify, "alpha", "UTC", now));
    expect((await read(T0)).view).toEqual({ checked_in: 3 });
    expect((await read(T0 + 30_000)).view).toEqual({ checked_in: 3 });
    expect(notify.reads).toBe(1);
    await checkinsMoved(kv, "alpha");
    expect(await read(T0 + 31_000)).toEqual({ view: { checked_in: 4 }, changesAt: null });
    await checkinsMoved(kv, "alpha");
    // Read 4 s ago: the next read waits until 10 s have passed, and the build plans it.
    expect(await read(T0 + 35_000)).toEqual({ view: { checked_in: 4 }, changesAt: T0 + 41_000 });
    expect((await read(T0 + 41_000)).view).toEqual({ checked_in: 5 });
    expect(notify.reads).toBe(3);
  });

  it("reads again after a check-in that lands while Notify counts", async () => {
    const kv = new MemoryKv(() => T0);
    const counts = [40, 41, 42];
    let reads = 0;
    const notify: Sources = {
      ...noSources,
      checkinCount: async () => {
        reads += 1;
        // Member 42 checks in after Notify counted 41, before this read returns.
        if (reads === 2) await checkinsMoved(kv, "alpha");
        return counts[reads - 1] ?? null;
      },
    };
    const read = (now: number) =>
      withTenant("alpha", () => readStats(kv, notify, "alpha", "UTC", now));
    expect((await read(T0)).view).toEqual({ checked_in: 40 });
    await checkinsMoved(kv, "alpha");
    expect((await read(T0 + 20_000)).view).toEqual({ checked_in: 41 });
    expect((await read(T0 + 40_000)).view).toEqual({ checked_in: 42 });
    expect(reads).toBe(3);
  });

  it("tries again at the next build when the read after a check-in fails", async () => {
    const kv = new MemoryKv(() => T0);
    const notify = sources([3, null, 4]);
    const read = (now: number) =>
      withTenant("alpha", () => readStats(kv, notify, "alpha", "UTC", now));
    expect((await read(T0)).view).toEqual({ checked_in: 3 });
    await checkinsMoved(kv, "alpha");
    expect((await read(T0 + 20_000)).view).toEqual({ checked_in: 3 });
    expect((await read(T0 + 40_000)).view).toEqual({ checked_in: 4 });
    expect(notify.reads).toBe(3);
  });

  it("reads the check-ins again once the kept count is 5 minutes old", async () => {
    // Notify also lowers its count without an event (a member deleting their data, retention).
    const kv = new MemoryKv(() => T0);
    const notify = sources([41, 40]);
    const read = (now: number) =>
      withTenant("alpha", () => readStats(kv, notify, "alpha", "UTC", now));
    expect((await read(T0)).view).toEqual({ checked_in: 41 });
    expect((await read(T0 + 5 * MIN - 1)).view).toEqual({ checked_in: 41 });
    expect((await read(T0 + 5 * MIN)).view).toEqual({ checked_in: 40 });
    expect(notify.reads).toBe(2);
  });

  it("says when the latest count stops being live, so a stopped bot's numbers go then", async () => {
    const kv = new MemoryKv(() => T0);
    // Counted a minute ago, every 60 s: live for three intervals, until 2 minutes from now.
    await keepPresence(kv, "alpha", at(1, 212));
    const read = (now: number) =>
      withTenant("alpha", () => readStats(kv, noSources, "alpha", "UTC", now));
    const live = await read(T0);
    expect(live.view).toMatchObject({ online: 212 });
    expect(live.changesAt).toBe(T0 + 2 * MIN + 1);
    expect(await read(T0 + 2 * MIN + 1)).toEqual({ view: null, changesAt: null });
  });
});
