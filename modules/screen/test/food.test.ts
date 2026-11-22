/**
 * The `food_status` box from pizza's events (#643; contracts/screen.md, Widgets; step 5 D2, L3,
 * L8, U11): Screen keeps each order's event-wide part as the events come (twice, late, out of
 * turn: the newest revision wins), and the box lists what is open or on the way, most urgent
 * first, with the first order's fields at the top as before; it is empty when nothing is, a
 * called-in order leaves it after 3 hours, and holder names follow the event's setting.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newId, withTenant } from "@canccu/kit";
import type { Event } from "@canccu/kit";
import { applyFoodEvent } from "../src/compose/food.js";
import { applyOverrideEvent } from "../src/compose/overrides.js";
import { DATABASE_URL, call, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

const NOW = "2026-01-01T17:00:00Z";
const person = (name: string) => ({ user_id: `u_${name}`, discord_user_id: null, name });

function order(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    seq: Number(id.slice(3)),
    state: "open",
    pizzeria: { id: "pz_1", name: "Demo Pizzeria" },
    target_at: "2026-01-01T17:30:00Z",
    closes_at: "2026-01-01T17:30:00Z",
    estimate_at: null,
    pickup: null,
    holder: person("Demo Player"),
    pizza_count: 9,
    people_count: 7,
    opened_at: "2026-01-01T16:40:00Z",
    closed_at: null,
    placed_at: null,
    arrived_at: null,
    done_at: null,
    revision: 1,
    ...over,
  };
}

interface Widget {
  widget: string;
  view: Record<string, unknown>;
}

describe.skipIf(!DATABASE_URL)("food on the screens", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await harness();
    h.sources.event = { name: "Demo Event" };
    h.sources.agenda = { current: [], next: [] };
    // The event's default zones are made at its first read.
    await call(h, "GET", "/api/screen/zones", { session: "admin" });
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    h.clock.now = Date.parse(NOW);
    h.settings.alpha = {};
    await withTenant("alpha", () => h.db.tenant((c) => c.query("DELETE FROM screen_food_orders")));
  });

  const pizza = (type: string, data: Record<string, unknown>): Event => ({
    id: newId(),
    type,
    version: 1,
    time: new Date(h.clock.now).toISOString(),
    source: "pizza",
    tenant: "alpha",
    data: { actor_user_id: null, ...data },
  });
  const apply = (type: string, data: Record<string, unknown>) =>
    withTenant("alpha", () => applyFoodEvent(h.db, pizza(type, data)));
  const box = async () => {
    const res = await call(h, "GET", "/api/screen/now?zone=main", { host: "alpha.test" });
    expect(res.statusCode).toBe(200);
    const regions = res.json<{ regions: { widgets: Widget[] }[] }>().regions;
    const found = regions.flatMap((r) => r.widgets).find((w) => w.widget === "food_status");
    expect(found).toBeDefined();
    return found?.view ?? {};
  };

  it("lists what is open or on the way, most urgent first, the first order on top (D2)", async () => {
    await apply("pizza.order.opened", { order: order("po_2") });
    await apply("pizza.order.placed", {
      order: order("po_1", {
        state: "placed",
        pizzeria: { id: "pz_2", name: "Demo Trattoria" },
        placed_at: "2026-01-01T16:31:00Z",
        estimate_at: "2026-01-01T17:31:00Z",
        revision: 4,
      }),
    });
    const v = await box();
    expect(v).toMatchObject({
      empty: false,
      title: "Food",
      state: "open",
      seq: 2,
      pizzeria_name: "Demo Pizzeria",
      target_at: "2026-01-01T17:30:00Z",
      pizza_count: 9,
      people_count: 7,
      holder_name: "Demo Player",
    });
    expect(v.orders).toEqual([
      expect.objectContaining({
        seq: 2,
        state: "open",
        pizzeria_name: "Demo Pizzeria",
        status_text: "Open · closes 17:30 · 9 pizzas",
      }),
      expect.objectContaining({
        seq: 1,
        state: "placed",
        pizzeria_name: "Demo Trattoria",
        estimate_at: "2026-01-01T17:31:00Z",
        status_text: "On the way · about 17:31",
      }),
    ]);
  });

  it("puts an order that is here first, with whom to collect it from", async () => {
    await apply("pizza.order.opened", { order: order("po_2") });
    await apply("pizza.order.arrived", {
      order: order("po_1", { state: "arrived", arrived_at: "2026-01-01T16:55:00Z", revision: 6 }),
      user_ids: ["u_a"],
      people: [],
    });
    const v = await box();
    expect(v).toMatchObject({ seq: 1, state: "arrived" });
    expect((v.orders as { status_text: string }[])[0]?.status_text).toBe(
      "Pizza is here · collect from Demo Player",
    );
  });

  // #771: the attendee's page and the notice say the pickup place; the box said the holder's name.
  it("says where to collect it when the holder named a place, whatever the names setting", async () => {
    await apply("pizza.order.arrived", {
      order: order("po_1", {
        state: "arrived",
        arrived_at: "2026-01-01T16:55:00Z",
        pickup: "Entrance table",
        revision: 6,
      }),
      user_ids: [],
      people: [],
    });
    const rows = async () => (await box()).orders as { status_text: string }[];
    expect((await rows())[0]?.status_text).toBe("Pizza is here · collect at Entrance table");
    h.settings.alpha = { food_holder_names: false };
    expect((await rows())[0]?.status_text).toBe("Pizza is here · collect at Entrance table");
  });

  // #771, the screen-energy rule: the first order's time, large, with its words small beside it.
  it("leads with the first order's close or estimate time, nothing to lead with otherwise", async () => {
    await apply("pizza.order.opened", { order: order("po_1") });
    expect(await box()).toMatchObject({ big_label: "Open · closes", big_text: "17:30" });
    await apply("pizza.order.placed", {
      order: order("po_1", {
        state: "placed",
        placed_at: "2026-01-01T16:31:00Z",
        estimate_at: "2026-01-01T17:31:00Z",
        revision: 4,
      }),
    });
    expect(await box()).toMatchObject({ big_label: "On the way · about", big_text: "17:31" });
    await apply("pizza.order.arrived", {
      order: order("po_1", { state: "arrived", arrived_at: "2026-01-01T16:55:00Z", revision: 6 }),
      user_ids: [],
      people: [],
    });
    expect(await box()).toMatchObject({ big_label: null, big_text: null });
  });

  // #771: Moments' `pizza` rule claimed a region that said "placed" and a countdown beside the box.
  it("draws Moments' pizza claim in the box's own words, never the API's state name", async () => {
    await apply("pizza.order.opened", { order: order("po_2") });
    await apply("pizza.order.placed", {
      order: order("po_1", {
        state: "placed",
        placed_at: "2026-01-01T16:31:00Z",
        estimate_at: "2026-01-01T17:31:00Z",
        revision: 4,
      }),
    });
    const claim = {
      id: "ov_pizza",
      kind: "block",
      zones: [],
      rank: 80,
      source: { module: "moments", event_id: null, ref: "po_1" },
      template: "pizza_placed",
      content: { state: "placed", seq: 1, pizzeria_name: "Demo Pizzeria", pizza_count: 9 },
      regions: ["venue_rail", "ticker"],
      ttl_seconds: 300,
      sound: null,
      steps: null,
      on_end: "resume",
      starts_at: NOW,
      ends_at: null,
    };
    await withTenant("alpha", () =>
      applyOverrideEvent(h.db, {
        id: newId(),
        type: "moments.override.started",
        version: 1,
        time: NOW,
        source: "moments",
        tenant: "alpha",
        data: { actor_user_id: null, override: claim },
      }),
    );
    const res = await call(h, "GET", "/api/screen/now?zone=main", { host: "alpha.test" });
    const regions = res.json<{
      regions: { claim: { content: Record<string, unknown> } | null }[];
    }>().regions;
    const content = regions.find((r) => r.claim !== null)?.claim?.content;
    // Its own order only, as the box draws it: the other order stays in the box.
    expect(content).toMatchObject({
      title: "Food",
      state: "placed",
      big_label: "On the way · about",
      big_text: "17:31",
      orders: [expect.objectContaining({ seq: 1, status_text: "On the way · about 17:31" })],
    });
    expect(content?.orders).toHaveLength(1);
    await withTenant("alpha", () => h.db.tenant((c) => c.query("DELETE FROM screen_claims")));
  });

  it("loses the holder's name when pizza forgets them (a privacy delete, #759)", async () => {
    const here = { state: "arrived", arrived_at: "2026-01-01T16:55:00Z" };
    await apply("pizza.order.arrived", {
      order: order("po_1", { ...here, revision: 6 }),
      user_ids: ["u_a"],
      people: [],
    });
    await apply("pizza.order.changed", {
      order: order("po_1", { ...here, holder: null, revision: 7 }),
      changed: ["holder"],
    });
    const v = await box();
    expect(v).toMatchObject({ seq: 1, state: "arrived", holder_name: null });
    expect(JSON.stringify(v)).not.toContain("Demo Player");
  });

  it("is empty when nothing is open or on the way (L3)", async () => {
    expect(await box()).toMatchObject({ empty: true });
    await apply("pizza.order.opened", { order: order("po_1") });
    await apply("pizza.order.done", {
      order: order("po_1", { state: "done", revision: 9 }),
      reason: "handed_out",
    });
    expect(await box()).toMatchObject({ empty: true });
  });

  it("keeps the newest revision, whatever order the events come in", async () => {
    await apply("pizza.order.closed", { order: order("po_1", { state: "closed", revision: 5 }) });
    // A late, older event changes nothing, and neither does the same event twice.
    await apply("pizza.order.opened", { order: order("po_1", { revision: 1 }) });
    expect(await box()).toMatchObject({ state: "closed" });
    // A pizza's event moves the counts on.
    await apply("pizza.item.removed", {
      order_id: "po_1",
      order_revision: 6,
      item_id: "pi_1",
      user_id: null,
      person: null,
      pizza_count: 8,
      people_count: 6,
    });
    expect(await box()).toMatchObject({ state: "closed", pizza_count: 8, people_count: 6 });
    await apply("pizza.order.cancelled", {
      order: order("po_1", { state: "cancelled", revision: 7 }),
      reason: "cancelled",
      user_ids: [],
      people: [],
    });
    await apply("pizza.order.closed", { order: order("po_1", { state: "closed", revision: 5 }) });
    expect(await box()).toMatchObject({ empty: true });
  });

  it("lets a called-in order go after 3 hours (U11)", async () => {
    await apply("pizza.order.placed", {
      order: order("po_1", { state: "placed", placed_at: "2026-01-01T14:01:00Z", revision: 3 }),
    });
    expect(await box()).toMatchObject({ state: "placed" });
    h.clock.now = Date.parse("2026-01-01T17:02:00Z");
    expect(await box()).toMatchObject({ empty: true });
  });

  it("leaves holder names out when the event's setting says so (L8)", async () => {
    await apply("pizza.order.arrived", {
      order: order("po_1", { state: "arrived", arrived_at: "2026-01-01T16:55:00Z", revision: 6 }),
      user_ids: [],
      people: [],
    });
    h.settings.alpha = { food_holder_names: false };
    const v = await box();
    expect(v.holder_name).toBeNull();
    expect(JSON.stringify(v)).not.toContain("Demo Player");
    expect((v.orders as { status_text: string }[])[0]?.status_text).toBe("Pizza is here");
  });
});
