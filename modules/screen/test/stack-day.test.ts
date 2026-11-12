// The demo fixture's run of show (#400): whatever the hour a CI run starts, the day the day view
// shows has the running item and a delayed one, and the screenshots never find it split over two
// dates. The delay is applied as agenda does: a running item keeps its start.
import { describe, expect, it } from "vitest";
import { placeDay } from "./stack/day.mjs";
import type { PlacedItem } from "./stack/day.mjs";

const MIN = 60_000;
const DAY = Date.UTC(2026, 10, 12);
const SHOTS = 20 * MIN;
const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const TODAY = dateOf(DAY);
const TOMORROW = dateOf(DAY + 24 * 60 * MIN);

function named(items: PlacedItem[], title: string): PlacedItem {
  const item = items.find((i) => i.title === title);
  if (item === undefined) throw new Error(`the fixture has no "${title}"`);
  return item;
}

function delayed(item: PlacedItem, now: number) {
  const start = Date.parse(item.starts_at);
  const end = Date.parse(item.ends_at);
  const by = item.delay * MIN;
  return start <= now ? { start, end: end + by } : { start: start + by, end: end + by };
}

// Every quarter hour of a day, at its first and its last second.
const RUNS = Array.from({ length: 96 }, (_, q) => DAY + q * 15 * MIN).flatMap((q) => [
  q,
  q + 15 * MIN - 1000,
]);

describe("the fixture's day", () => {
  it.each(RUNS)("at %d has a running and a delayed item on the event's date", (now) => {
    const items = placeDay(now);
    const shown = items.map((i) => ({ ...i, ...delayed(i, now) }));
    for (const i of shown) expect(i.end, i.title).toBeGreaterThan(i.start);

    const dinner = { ...named(items, "Dinner"), ...delayed(named(items, "Dinner"), now) };
    expect(dinner.start).toBeLessThanOrEqual(now);
    expect(dinner.end).toBeGreaterThan(now + SHOTS);
    expect(dateOf(dinner.start)).toBe(TODAY);
    expect(dinner.delay).toBeGreaterThan(0);

    const later = items.filter((i) => i.starts_at.slice(0, 10) === TOMORROW);
    expect(later.map((i) => i.title)).toEqual(
      expect.arrayContaining(["Breakfast", "Demo Game Cup, awards"]),
    );
  });

  it.each(RUNS.filter((now) => now - DAY >= 15 * MIN && now - DAY < (24 * 60 - 15) * MIN))(
    "at %d keeps the whole day on one date, with the semis delayed before it starts",
    (now) => {
      const items = placeDay(now);
      const semis = named(items, "Demo Game Cup, semis");
      expect(Date.parse(semis.starts_at)).toBeGreaterThan(now);
      expect(semis.delay).toBeGreaterThan(0);
      const onToday = items.filter((i) => dateOf(delayed(i, now).start) === TODAY);
      expect(onToday).toHaveLength(8);
    },
  );
});
