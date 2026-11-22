/**
 * Food switched off for an event (`pizza.enabled`, #747): its pages answer "not at this event",
 * its scheduler leaves the event's orders alone, and its data stays.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Scheduler } from "../src/scheduler.js";
import {
  DATABASE_URL,
  T0,
  TRUNCATE,
  freshDatabase,
  json,
  seedPizzerias,
  world,
} from "./helpers.js";
import type { World } from "./helpers.js";
import { view } from "./forms.js";

const OFF = "off.test";

describe.skipIf(!DATABASE_URL)("Food switched off for the event", () => {
  let pool: pg.Pool;
  let w: World;

  beforeAll(async () => {
    pool = await freshDatabase();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(TRUNCATE);
    w = await world(pool);
  });

  /** An order at each event, open and closing at T0 + 60 min, with a pizza in it. */
  async function orders(): Promise<{ on: string; off: string }> {
    const made: string[] = [];
    for (const host of ["demo.test", OFF]) {
      const { pz } = await seedPizzerias(w, host);
      const p = json(
        await w.call("pena", "GET", `/api/pizza/pizzerias/${pz}`, undefined, { host }),
      );
      const item = (p.menu as { items: { id: string; number: string }[] }).items[0]?.id;
      const id = json(
        await w.call(
          "pena",
          "POST",
          "/api/pizza/orders",
          { pizzeria_id: pz, closes_at: new Date(T0.getTime() + 3600_000).toISOString() },
          { host },
        ),
      ).id as string;
      await w.call(
        "anni",
        "POST",
        `/api/pizza/orders/${id}/items`,
        { kind: "menu", menu_item_id: item },
        { host },
      );
      made.push(id);
    }
    return { on: made[0] ?? "", off: made[1] ?? "" };
  }

  it("answers every Food page with not at this event, for attendees and the crew", async () => {
    for (const [who, path] of [
      ["anni", "/"],
      [null, "/"],
      ["anni", "/go"],
      ["crew", "/crew"],
      ["organiser", "/crew/settings"],
      ["treasurer", "/crew/record"],
    ] as const) {
      const r = await view(w, who, path, OFF);
      expect(r.statusCode, `${who ?? "guest"} ${path}`).toBe(404);
      expect(r.body).toContain("Food is not at this event");
    }
    // The page's own look still loads.
    expect((await view(w, "anni", "/static/pizza.css", OFF)).statusCode).toBe(200);
    // Another event's Food is untouched.
    expect((await view(w, "anni", "/")).statusCode).toBe(200);
  });

  it("stops the event's scheduled steps and keeps its orders", async () => {
    const { on, off } = await orders();
    const scheduler = new Scheduler(w.deps);
    w.setNow(new Date(T0.getTime() + 61 * 60_000).toISOString());
    await scheduler.tick();
    const state = async (id: string, host: string) =>
      json(await w.call("pena", "GET", `/api/pizza/orders/${id}`, undefined, { host })).state;
    expect(await state(on, "demo.test")).toBe("closed");
    expect(await state(off, OFF)).toBe("open");
    expect(w.events("off").filter((e) => e.type === "pizza.order.closing")).toHaveLength(0);
  });
});
