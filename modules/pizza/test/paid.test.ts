/**
 * Settling to the payer (#644; M1, U12 A, the PO note on "Pay me with"): Paid ticks are the
 * holder's memo, only when the order settles to its payer; each person sees their own amount, their
 * own mark and how to pay the payer; nobody else does, and none of it travels on the bus.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import {
  DATABASE_URL,
  TRUNCATE,
  errorOf,
  freshDatabase,
  itemId,
  json,
  open,
  seedPizzerias,
  world,
} from "./helpers.js";
import type { World } from "./helpers.js";

let pool: pg.Pool;
let w: World;
let pz: string;
let id: string;
const PAY = { mobilepay: "040 000 0000", iban: "FI21 1234 5600 0007 85" };

beforeAll(async () => {
  if (DATABASE_URL) pool = await freshDatabase();
});
afterAll(async () => {
  if (DATABASE_URL) await pool.end();
});
beforeEach(async () => {
  if (!DATABASE_URL) return;
  await pool.query(TRUNCATE);
  w = await world(pool);
  w.settings.set("demo", { ...DEFAULT_SETTINGS, settle_to_payer: true });
  ({ pz } = await seedPizzerias(w));
  id = json(await open(w, "pena", pz)).id as string;
  for (const [who, number] of [
    ["anni", "1"],
    ["mikko", "12"],
    ["pena", "3"],
  ] as const) {
    await w.call(who, "POST", `/api/pizza/orders/${id}/items`, {
      kind: "menu",
      menu_item_id: await itemId(w, pz, number),
    });
  }
  await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
  await w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, { total_cents: 2800 });
});

const toPayer = () =>
  w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, { settle_to: "payer" });
const tick = (who: string, user: string, paid = true) =>
  w.call(who, "PUT", `/api/pizza/orders/${id}/paid/${user}`, { paid });
const money = (who = "pena") => w.call(who, "GET", `/api/pizza/orders/${id}/money`);
const view = (who: string | null) => w.call(who, "GET", `/api/pizza/orders/${id}`);
const paidOf = (m: Record<string, unknown>) =>
  Object.fromEntries((m.people as { name: string; paid: boolean | null }[]).map((p) => [p.name, p.paid]));

describe.skipIf(!DATABASE_URL)("Paid ticks", () => {
  it("are only for an order that settles to its payer", async () => {
    expect(errorOf(await tick("pena", "u_anni")).code).toBe("not_settled_to_payer");
    await toPayer();
    expect((await tick("pena", "u_anni")).statusCode).toBe(200);
    expect(paidOf(json(await money()))).toEqual({ Anni: true, Mikko: false, Pena: null });
    await tick("pena", "u_anni", false);
    expect(paidOf(json(await money()))).toMatchObject({ Anni: false });
  });

  it("are for someone in the order other than the payer", async () => {
    await toPayer();
    expect(errorOf(await tick("pena", "u_tero")).code).toBe("invalid_request");
    expect(errorOf(await tick("pena", "u_pena")).code).toBe("invalid_request");
  });

  it("are the holder's and the crew's to set, not a member's", async () => {
    await toPayer();
    expect(errorOf(await tick("anni", "u_anni")).code).toBe("not_holder");
    expect((await tick("crew", "u_mikko")).statusCode).toBe(200);
  });

  it("are seen whole by the holder, the crew and the organiser, and by each person only their own", async () => {
    await toPayer();
    await tick("pena", "u_anni");
    for (const who of ["pena", "crew", "treasurer"]) {
      expect(paidOf(json(await money(who))), who).toMatchObject({ Anni: true, Mikko: false });
    }
    expect(json(await view("anni"))).toMatchObject({ my_paid: true, my_amount_cents: 850 });
    const mikko = json(await view("mikko"));
    expect(mikko).toMatchObject({ my_paid: false });
    expect(JSON.stringify(mikko)).not.toMatch(/Anni|u_anni/);
    expect(errorOf(await money("anni")).code).toBe("not_holder");
  });

  it("never travel on the bus", async () => {
    await toPayer();
    await tick("pena", "u_anni");
    expect(JSON.stringify(w.events())).not.toMatch(/paid":|my_paid/);
  });
});

describe.skipIf(!DATABASE_URL)("Pay me with", () => {
  it("is kept on the payer's own details and offered again", async () => {
    expect(json(await w.call("pena", "GET", "/api/pizza/me/pay-details"))).toEqual({
      mobilepay: null,
      iban: null,
      updated_at: null,
    });
    const res = await w.call("pena", "PUT", "/api/pizza/me/pay-details", PAY);
    expect(json(res)).toMatchObject({ mobilepay: "040 000 0000", iban: "FI21 1234 5600 0007 85" });
    expect(json(await w.call("pena", "GET", "/api/pizza/me/pay-details"))).toMatchObject(PAY);
  });

  it("takes a phone number and a valid IBAN only", async () => {
    const put = (b: unknown) => w.call("pena", "PUT", "/api/pizza/me/pay-details", b);
    expect(errorOf(await put({ mobilepay: "call me", iban: null })).code).toBe("invalid_request");
    expect(errorOf(await put({ mobilepay: null, iban: "FI21 1234 5600 0007 86" })).code).toBe(
      "invalid_request",
    );
    expect((await put({ mobilepay: null, iban: "fi2112345600000785" })).statusCode).toBe(200);
  });

  it("reaches the order's people with their amount when it settles to the payer, and nobody else", async () => {
    await w.call("pena", "PUT", "/api/pizza/me/pay-details", PAY);
    expect(json(await view("anni")).pay_to).toBeNull();
    await toPayer();
    expect(json(await view("anni"))).toMatchObject({
      settle_to: "payer",
      my_amount_cents: 850,
      pay_to: { name: "Pena", ...PAY },
    });
    expect(json(await view("crew")).pay_to).toMatchObject(PAY);
    expect(json(await view("tero")).pay_to).toBeUndefined();
    expect(json(await view(null)).pay_to).toBeUndefined();
    expect(JSON.stringify(w.events())).not.toContain("FI21");
  });

  it("is in the privacy export, and goes with the privacy delete", async () => {
    await w.call("pena", "PUT", "/api/pizza/me/pay-details", PAY);
    expect(json(await w.call("pena", "GET", "/api/pizza/me/export"))).toMatchObject({
      pay_details: PAY,
    });
    await w.call("pena", "DELETE", "/api/pizza/me");
    expect(json(await w.call("pena", "GET", "/api/pizza/me/pay-details"))).toMatchObject({
      mobilepay: null,
      iban: null,
    });
  });
});
