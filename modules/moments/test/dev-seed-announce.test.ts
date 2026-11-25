/**
 * The demo event's announcements on the dev server (#788): each day of the run of show gets one
 * scheduled info announcement (before its tournament item) and one urgent one (before its raffle);
 * dev mode only, each item's once, never again after a hand change, `force` as the reset.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  NOTHING_AHEAD,
  Refused,
  UP_TO_DATE,
  scheduled,
  seedDemoAnnouncements,
} from "../src/dev-seed-announce.js";
import type { AgendaItem } from "../src/scene-eval.js";
import { listAnnouncements } from "../src/announce/store.js";
import { DATABASE_URL, T0, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";
import { TABLES } from "./story-kit.js";

type Item = AgendaItem & { title: string };

const item = (id: string, title: string, starts: string): Item => ({
  id,
  title,
  kind: "activity",
  visibility: "public",
  status: "scheduled",
  starts_at: starts,
  ends_at: null,
});
// T0 is 2026-01-01 18:00 UTC; the event's time zone is Helsinki (UTC+2).
const AGENDA = [
  item("it_group", "Tournament: group stage", "2026-01-01T19:00:00Z"),
  item("it_dinner", "Dinner", "2026-01-01T19:30:00Z"),
  item("it_raffle", "Raffle", "2026-01-01T21:00:00Z"),
  item("it_finals", "Tournament: finals", "2026-01-02T12:00:00Z"),
  item("it_raffle2", "Raffle", "2026-01-02T15:15:00Z"),
];

describe.skipIf(!DATABASE_URL)("the dev seed's announcements", () => {
  let pool: pg.Pool;
  let w: World;

  beforeAll(async () => {
    pool = await freshDatabase();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${TABLES}, moments_announcements`);
    w = world(pool);
  });

  const seed = (o: { force?: boolean; version?: string; items?: Item[] } = {}) =>
    seedDemoAnnouncements(
      { db: w.db, now: () => w.now },
      {
        version: o.version ?? "dev",
        items: o.items ?? AGENDA,
        timeZone: "Europe/Helsinki",
        eventName: "Demo Event",
        force: o.force ?? false,
      },
    );
  const list = () => w.tx("demo", (c) => listAnnouncements(c));
  const open = async () =>
    (await list())
      .filter((a) => a.status === "scheduled")
      .map((a) => [a.level, a.title_text, a.fire_at?.toISOString()])
      .sort((a, b) => String(a[2]).localeCompare(String(b[2])));

  it("is refused outside dev mode and changes nothing", async () => {
    await expect(seed({ version: "1.4.0" })).rejects.toThrow(Refused);
    expect(await list()).toEqual([]);
  });

  it("schedules an info one before each tournament item and an urgent one before each raffle", async () => {
    expect(await seed()).toBe(scheduled(4));
    expect(await open()).toEqual([
      ["info", "Tournament: group stage at 21:00", "2026-01-01T18:45:00.000Z"],
      ["urgent", "Raffle at 23:00", "2026-01-01T20:30:00.000Z"],
      ["info", "Tournament: finals at 14:00", "2026-01-02T11:45:00.000Z"],
      ["urgent", "Raffle at 17:15", "2026-01-02T14:45:00.000Z"],
    ]);
    const [first] = await list();
    // Screen and ticker only: no Discord or push from demo data.
    expect(first?.channels).toEqual({ screen: true, ticker: true, discord: false, push: false });
    expect(first?.zones).toEqual([]);
  });

  it("a second run changes nothing", async () => {
    await seed();
    expect(await seed()).toBe(UP_TO_DATE);
    expect((await list()).length).toBe(4);
  });

  it("schedules none whose time has passed", async () => {
    w.now = new Date("2026-01-01T20:40:00Z");
    expect(await seed()).toBe(scheduled(2));
    expect((await open()).map((a) => a[1])).toEqual([
      "Tournament: finals at 14:00",
      "Raffle at 17:15",
    ]);
  });

  it("schedules the items of a new day, once each", async () => {
    await seed({ items: AGENDA.slice(0, 3) });
    expect(await seed()).toBe(scheduled(2));
    expect((await list()).length).toBe(4);
  });

  it("never brings back one withdrawn by hand", async () => {
    await seed();
    await pool.query(
      `UPDATE moments_announcements SET status = 'withdrawn' WHERE level = 'urgent'`,
    );
    expect(await seed()).toBe(UP_TO_DATE);
    expect((await open()).map((a) => a[0])).toEqual(["info", "info"]);
  });

  it("says so when nothing is ahead", async () => {
    expect(await seed({ items: [AGENDA[1] as Item] })).toBe(NOTHING_AHEAD);
  });

  it("force withdraws the seed's scheduled ones and schedules them afresh", async () => {
    await seed();
    await pool.query(
      `UPDATE moments_announcements SET status = 'withdrawn' WHERE level = 'urgent'`,
    );
    expect(await seed({ force: true })).toBe(scheduled(4));
    expect((await open()).length).toBe(4);
    const all = await list();
    expect(all.filter((a) => a.status === "withdrawn").length).toBe(4);
    expect(all.every((a) => a.status !== "live")).toBe(true);
  });

  it("other events are untouched", async () => {
    await seed();
    expect(await w.tx("two", (c) => listAnnouncements(c))).toEqual([]);
  });

  it("starts from T0 in these tests", () => {
    expect(w.now.toISOString()).toBe(T0.toISOString());
  });
});
