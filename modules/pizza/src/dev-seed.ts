/**
 * The demo event's food on the dev server (#715): `setup/deploy` runs `node dist/dev-seed-cli.js`
 * after admin's seed (#709), in dev mode only. Admin loads the demo profile but does not apply its
 * `pizza` section, so this applies it as contracts/profile.md says (a pizzeria matched by name is
 * edited, one not there added, its menu replaced, others stay) and opens one demo order with
 * several people, settling to its holder, some of them marked paid, as #704's demo order has it.
 *
 * Every write goes through the module's own steps (`openOrder`, `addItem`, `applyMenu`), so the
 * screens and the hub see an ordinary order. Never over work made by hand:
 * - the menus are applied to an event with no pizzerias, and again when the profile's section
 *   changed while the menus are still what the seed left (a hash of both, kept on the files volume
 *   beside the event's other pizza files);
 * - the demo order opens only while the event has no order under way, so an order someone took on
 *   is never touched; once it is done or cancelled, the next run opens a fresh one.
 * `force` (resetting the demo event, docs/operations/dev-server.md) cancels the orders under way,
 * applies the menus over any change and opens a fresh demo order.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { DEMO_TENANT, withTenant } from "@canccu/kit";
import type { Outbox, SqlClient } from "@canccu/kit";
import type { Db } from "./db.js";
import { addItem, openOrder } from "./items.js";
import { cancel } from "./lifecycle.js";
import type { Step } from "./lifecycle.js";
import { applyMenu, menuInputOf } from "./menus.js";
import { newId } from "./ids.js";
import type { MenuInput, OrderState, Service } from "./model.js";
import { liveMenu, listPizzerias, menuEntries, ordersWhere } from "./store.js";
import type { Actor } from "./store.js";
import { dayTurn, eventDay } from "./time.js";
import {
  parseItemBody,
  parseMenuBody,
  parseWebsite,
  requiredText,
  snapshotOf,
} from "./validate.js";

export const LOADED_MENUS = "applied the demo profile's pizzerias and menus";
export const UP_TO_DATE_MENUS = "the demo event holds the demo profile's menus; nothing changed";
export const HAND_MADE_MENUS =
  "the demo event's pizzerias or menus were changed by hand; nothing changed" +
  " (reset the demo event to apply the demo menus again)";
export const OPENED_ORDER = "opened the demo order";
export const NO_PIZZERIA = "the demo event has no Demo Pizzeria; no demo order opened";
export const ORDER_LIVE = "the demo event has an order under way; nothing changed";

export class Refused extends Error {}

export interface SeedDeps {
  db: Db;
  outbox: Outbox;
  now: () => Date;
  filesRoot: string;
}

interface Pizzeria {
  name: string;
  phone: string | null;
  website: string | null;
  service: Service;
  menu: MenuInput;
}

/** Placeholder people (no real accounts): the holder first, who is also the payer. */
const PEOPLE: readonly (Actor & { number: string; paid: boolean })[] = [
  { user_id: "u_demo_alex", name: "Alex", number: "3", paid: false },
  { user_id: "u_demo_sam", name: "Sam", number: "1", paid: true },
  { user_id: "u_demo_robin", name: "Robin", number: "12", paid: true },
  { user_id: "u_demo_kim", name: "Kim", number: "20", paid: false },
  { user_id: "u_demo_jo", name: "Jo", number: "1", paid: false },
];
const DEMO_PIZZERIA = "Demo Pizzeria";
const MARK = "dev-seed.json";

/** The `pizza.pizzerias` of the demo profile (`profile.yaml` in `dir`), or [] without one. */
export async function demoPizzerias(dir: string): Promise<unknown> {
  const doc = parse(await readFile(join(dir, "profile.yaml"), "utf8")) as {
    pizza?: { pizzerias?: unknown };
  } | null;
  return doc?.pizza?.pizzerias ?? [];
}

/** The section as the menu CSV's rows are read, with the same rules (validate.ts). */
function pizzeriasOf(section: unknown): Pizzeria[] {
  if (!Array.isArray(section)) throw new Refused("the demo profile's pizza.pizzerias is no list");
  return section.map((raw: unknown, i) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
      name: requiredText(p.name, `pizzerias[${i}].name`, 80),
      phone: typeof p.phone === "string" ? p.phone : null,
      website: parseWebsite(p.website),
      service: p.service === "takeaway" ? "takeaway" : "delivery",
      menu: parseMenuBody({ items: p.items, base: p.base, toppings: p.toppings }),
    };
  });
}

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

/** Every pizzeria, hidden ones too, with its visible menu: what a hand change would alter. */
async function menuState(c: SqlClient): Promise<string> {
  const all = await listPizzerias(c, true);
  const entries = await menuEntries(
    c,
    all.map((p) => p.id),
    true,
  );
  return hash(
    all
      .map((p) => ({
        name: p.name,
        phone: p.phone,
        website: p.website,
        service: p.service,
        hidden: p.hidden_at !== null,
        menu: menuInputOf(entries.filter((e) => e.pizzeria_id === p.id)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
}

async function applyPizzerias(c: SqlClient, list: Pizzeria[], now: Date): Promise<void> {
  const existing = await listPizzerias(c);
  for (const p of list) {
    let id = existing.find((e) => e.name.toLowerCase() === p.name.toLowerCase())?.id;
    if (id === undefined) {
      id = newId("pz");
      await c.query(
        `INSERT INTO pizza_pizzerias (id, name, phone, website, service) VALUES ($1, $2, $3, $4, $5)`,
        [id, p.name, p.phone, p.website, p.service],
      );
    } else {
      await c.query(
        `UPDATE pizza_pizzerias SET phone = $2, website = $3, service = $4, updated_at = $5 WHERE id = $1`,
        [id, p.phone, p.website, p.service, now],
      );
    }
    await applyMenu(c, id, p.menu, now);
  }
}

async function readMark(file: string): Promise<{ profile: string; menus: string } | null> {
  const text = await readFile(file, "utf8").catch(() => null);
  return text === null ? null : (JSON.parse(text) as { profile: string; menus: string });
}

const LIVE: readonly OrderState[] = ["open", "closed", "placed", "arrived"];

/** The demo order at Demo Pizzeria, open until the event day turns, its people and Paid ticks. */
async function openDemoOrder(s: Step, timeZone: string): Promise<string> {
  const [pz] = (await listPizzerias(s.c)).filter((p) => p.name === DEMO_PIZZERIA);
  if (pz === undefined) return NO_PIZZERIA;
  const day = eventDay(s.now, timeZone);
  const turn = dayTurn(day, timeZone).getTime();
  const closes = new Date(Math.max(turn - 3_600_000, s.now.getTime() + 15 * 60_000));
  const [holder, ...rest] = PEOPLE;
  if (holder === undefined) return NO_PIZZERIA;
  const order = await openOrder(s, holder, {
    pizzeria: { id: pz.id, name: pz.name },
    closes_at: closes,
    note: "Demo order",
    day,
    max_open: Number.MAX_SAFE_INTEGER,
  });
  const menu = await liveMenu(s.c, pz.id);
  for (const person of [holder, ...rest]) {
    const entry = menu.items.find((m) => m.number === person.number);
    if (entry === undefined) continue;
    const input = parseItemBody({ kind: "menu", menu_item_id: entry.id }, menu);
    const snap = snapshotOf(input, menu);
    await addItem(s, person, order.id, input, snap, Number.MAX_SAFE_INTEGER, pz.id);
  }
  // Settling to the holder, with Paid ticks: a memo only, never on the bus (paid.ts).
  await s.c.query(
    `UPDATE pizza_orders SET settle_to = 'payer', payer_user_id = $2, payer_name = $3 WHERE id = $1`,
    [order.id, holder.user_id, holder.name],
  );
  for (const person of rest.filter((p) => p.paid)) {
    await s.c.query(`INSERT INTO pizza_paid (order_id, user_id, at) VALUES ($1, $2, $3)`, [
      order.id,
      person.user_id,
      s.now,
    ]);
  }
  return OPENED_ORDER;
}

export async function seedDemoFood(
  d: SeedDeps,
  o: { version: string; timeZone: string; pizzerias: unknown; force: boolean },
): Promise<string[]> {
  if (o.version !== "dev")
    throw new Refused(`CANCCU_VERSION is ${o.version}, not dev: nothing changed`);
  const list = pizzeriasOf(o.pizzerias);
  const want = hash(list);
  const markFile = join(d.filesRoot, DEMO_TENANT, "pizza", MARK);
  const mark = await readMark(markFile);
  const now = d.now();
  // The scheduler's steps and the people's names need no lookup: these people have no accounts.
  const step = (c: SqlClient): Step => ({
    c,
    e: { outbox: d.outbox, people: () => Promise.resolve({ discord_user_id: null }) },
    now,
    actor: null,
  });
  return withTenant(DEMO_TENANT, async () => {
    const out = await d.db.tenant(async (c) => {
      const said: string[] = [];
      const before = await menuState(c);
      const empty = (await listPizzerias(c, true)).length === 0;
      if (!o.force && !empty && mark?.menus !== before) said.push(HAND_MADE_MENUS);
      else if (!o.force && !empty && mark?.profile === want) said.push(UP_TO_DATE_MENUS);
      else {
        await applyPizzerias(c, list, now);
        said.push(LOADED_MENUS);
      }
      const live = await ordersWhere(c, `state = ANY($1::text[])`, [LIVE]);
      if (o.force)
        for (const order of live)
          await cancel(step(c), order.id, LIVE, "cancelled", "Demo event reset");
      if (!o.force && live.length > 0) said.push(ORDER_LIVE);
      else {
        said.push(await openDemoOrder(step(c), o.timeZone));
      }
      return { said, menus: said[0] === LOADED_MENUS ? await menuState(c) : null };
    });
    await d.outbox.flush();
    if (out.menus !== null) {
      await mkdir(join(d.filesRoot, DEMO_TENANT, "pizza"), { recursive: true });
      await writeFile(markFile, JSON.stringify({ profile: want, menus: out.menus }) + "\n");
    }
    return out.said;
  });
}
