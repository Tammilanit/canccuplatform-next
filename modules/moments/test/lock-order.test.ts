/**
 * A crew action takes the zone's row before the moment's (#777): a pass holds the zone and then
 * writes the moment and its slots, so an end that held the moment first deadlocked with it and
 * answered 500, leaving the moment on air.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import type { MomentRequest } from "../src/engine.js";
import { lockZone } from "../src/air-store.js";
import { applyClaims } from "../src/placements.js";
import { lockMoment } from "../src/store.js";
import { DATABASE_URL, claims, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";

const run = DATABASE_URL ? describe : describe.skip;

const spot: MomentRequest = {
  class: "spotlight",
  template: "announcement",
  content: { title: "Hello", body: "", level: "info" },
  origin: "crew",
  why: "crew",
  regions: ["hero"],
  ttl_seconds: 60,
};

run("a crew action's lock order", () => {
  let pool: pg.Pool | undefined;
  let w: World;
  beforeEach(async () => {
    if (pool !== undefined) await pool.end();
    pool = await freshDatabase();
    w = world(pool);
    await w.tx("demo", (c) => c.query(`INSERT INTO moments_zones (zone_key) VALUES ('main')`));
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("waits for the zone before it locks the moment", async () => {
    const started = await w.tx("demo", (c) => w.engine.request(c, spot, w.at(0)));
    if (started.status !== "started") throw new Error("not started");
    const id = started.moment.id;
    let release = (): void => undefined;
    const held = new Promise<void>((r) => (release = r));
    let zoneHeld = (): void => undefined;
    const zoneIsHeld = new Promise<void>((r) => (zoneHeld = r));
    const pass = w.tx("demo", async (c) => {
      await lockZone(c, "main", "wait");
      zoneHeld();
      await held;
    });
    await zoneIsHeld;
    // The action stays open, as a crew action does while it works, so what it locks stays locked.
    let finish = (): void => undefined;
    const working = new Promise<void>((r) => (finish = r));
    const action = w.tx("demo", async (c) => {
      const m = await lockMoment(c, id);
      await working;
      return m;
    });
    await new Promise((r) => setTimeout(r, 300));
    // The action is waiting on the zone, so it holds no row of the moment: a pass could write it.
    await expect(
      w.tx("demo", (c) => c.query(`SELECT id FROM moments WHERE id = $1 FOR UPDATE NOWAIT`, [id])),
    ).resolves.toBeDefined();
    release();
    await pass;
    finish();
    expect((await action)?.id).toBe(id);
  });

  /** Holds the zone in an open transaction, runs `act` meanwhile, and says whether it held the moment. */
  const whileZoneHeld = async (id: string, act: () => Promise<unknown>): Promise<void> => {
    let release = (): void => undefined;
    const held = new Promise<void>((r) => (release = r));
    let zoneHeld = (): void => undefined;
    const zoneIsHeld = new Promise<void>((r) => (zoneHeld = r));
    const pass = w.tx("demo", async (c) => {
      await lockZone(c, "main", "wait");
      zoneHeld();
      await held;
    });
    await zoneIsHeld;
    const action = act();
    await new Promise((r) => setTimeout(r, 300));
    // Waiting on the zone, the action holds no row of the moment: a pass could still write it.
    await expect(
      w.tx("demo", (c) => c.query(`SELECT id FROM moments WHERE id = $1 FOR UPDATE NOWAIT`, [id])),
    ).resolves.toBeDefined();
    release();
    await pass;
    await action;
  };

  it("Screen's claims report waits for the zone before it locks the moment", async () => {
    const started = await w.tx("demo", (c) => w.engine.request(c, spot, w.at(0)));
    if (started.status !== "started") throw new Error("not started");
    const id = started.moment.id;
    await whileZoneHeld(id, () =>
      w.tx("demo", (c) =>
        applyClaims(c, claims("main", [[`${id}.main`, "hero"]], [], []), w.at(1), w.engine),
      ),
    );
  });

  it("a rule's renewal waits for the zone before it locks the moment", async () => {
    const req = { ...spot, dedupe_key: "k" };
    const started = await w.tx("demo", (c) => w.engine.request(c, req, w.at(0)));
    if (started.status !== "started") throw new Error("not started");
    await whileZoneHeld(started.moment.id, () =>
      w.tx("demo", (c) => w.engine.request(c, req, w.at(1))),
    );
  });
});
