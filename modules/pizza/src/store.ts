/** The pizza tables' rows and their reads; writes live with the steps that make them. */
import type { SqlClient } from "@canccu/kit";
import type {
  DoneReason,
  ItemKind,
  MenuEntry,
  OrderState,
  Service,
  SettleTo,
  Split,
} from "./model.js";

export interface OrderRow {
  id: string;
  day: string;
  seq: number;
  pizzeria_id: string;
  pizzeria_name: string;
  state: OrderState;
  closes_at: Date;
  note: string | null;
  opened_at: Date;
  opened_by_user_id: string | null;
  holder_user_id: string | null;
  holder_name: string | null;
  claimed_at: Date | null;
  closed_at: Date | null;
  placed_at: Date | null;
  estimate_at: Date | null;
  arrived_at: Date | null;
  pickup: string | null;
  done_at: Date | null;
  done_reason: DoneReason | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  cancelled_by_user_id: string | null;
  auto_released: boolean;
  nudged_at: Date | null;
  payer_user_id: string | null;
  payer_name: string | null;
  total_cents: number | null;
  split: Split | null;
  settle_to: SettleTo;
  total_set_at: Date | null;
  total_set_by_name: string | null;
  total_receipt_id: string | null;
  revision: number;
}

export interface ItemRow {
  id: string;
  order_id: string;
  user_id: string | null;
  name: string | null;
  kind: ItemKind;
  menu_item_id: string | null;
  number: string | null;
  label: string;
  description: string | null;
  toppings: string[] | null;
  text: string | null;
  note: string | null;
  comment: string | null;
  price_cents: number | null;
  handed_out_at: Date | null;
  created_at: Date;
}

export interface PizzeriaRow {
  id: string;
  name: string;
  phone: string | null;
  website: string | null;
  service: Service;
  hidden_at: Date | null;
}

/** The order's columns, its day as text (pg would make a `date` a local midnight). */
export const ORDER_COLUMNS = `id, to_char(day, 'YYYY-MM-DD') AS day, seq, pizzeria_id, pizzeria_name, state,
  closes_at, note, opened_at, opened_by_user_id, holder_user_id, holder_name, claimed_at, closed_at,
  placed_at, estimate_at, arrived_at, pickup, done_at, done_reason, cancelled_at, cancel_reason,
  cancelled_by_user_id, auto_released, nudged_at, payer_user_id, payer_name, total_cents, split, settle_to, total_set_at, total_set_by_name,
  total_receipt_id, revision`;

const ITEM_COLUMNS = `id, order_id, user_id, name, kind, menu_item_id, number, label, description,
  toppings, text, note, comment, price_cents, handed_out_at, created_at`;

export async function getOrder(c: SqlClient, id: string, lock = false): Promise<OrderRow | null> {
  const { rows } = await c.query(
    `SELECT ${ORDER_COLUMNS} FROM pizza_orders WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return (rows[0] as OrderRow | undefined) ?? null;
}

export async function ordersWhere(
  c: SqlClient,
  where: string,
  values: unknown[],
): Promise<OrderRow[]> {
  const { rows } = await c.query(
    `SELECT ${ORDER_COLUMNS} FROM pizza_orders WHERE ${where} ORDER BY day, seq`,
    values,
  );
  return rows as unknown as OrderRow[];
}

export async function itemsOf(c: SqlClient, orderIds: string[]): Promise<ItemRow[]> {
  if (orderIds.length === 0) return [];
  const { rows } = await c.query(
    `SELECT ${ITEM_COLUMNS} FROM pizza_items WHERE order_id = ANY($1::text[]) ORDER BY seq`,
    [orderIds],
  );
  return rows as unknown as ItemRow[];
}

export async function getItem(c: SqlClient, id: string): Promise<ItemRow | null> {
  const { rows } = await c.query(`SELECT ${ITEM_COLUMNS} FROM pizza_items WHERE id = $1`, [id]);
  return (rows[0] as ItemRow | undefined) ?? null;
}

export interface Counts {
  pizza_count: number;
  people_count: number;
}

/** Pizzas and people; an anonymised row keeps a pseudonym, so the counts stay as they were. */
export function countsOf(items: ItemRow[]): Counts {
  return {
    pizza_count: items.length,
    people_count: new Set(items.map((i) => i.user_id ?? i.id)).size,
  };
}

export async function getPizzeria(c: SqlClient, id: string): Promise<PizzeriaRow | null> {
  const { rows } = await c.query(
    `SELECT id, name, phone, website, service, hidden_at FROM pizza_pizzerias WHERE id = $1`,
    [id],
  );
  return (rows[0] as PizzeriaRow | undefined) ?? null;
}

export async function listPizzerias(c: SqlClient, hidden = false): Promise<PizzeriaRow[]> {
  const { rows } = await c.query(
    `SELECT id, name, phone, website, service, hidden_at FROM pizza_pizzerias
     ${hidden ? "" : "WHERE hidden_at IS NULL"} ORDER BY lower(name), id`,
    [],
  );
  return rows as unknown as PizzeriaRow[];
}

export interface MenuRow extends MenuEntry {
  pizzeria_id: string;
  hidden: boolean;
}

export async function menuEntries(
  c: SqlClient,
  pizzeriaIds: string[],
  hidden = false,
): Promise<MenuRow[]> {
  const { rows } = await c.query(
    `SELECT id, pizzeria_id, kind, number, name, description, price_cents, hidden_at IS NOT NULL AS hidden
     FROM pizza_menu_entries WHERE pizzeria_id = ANY($1::text[]) ${hidden ? "" : "AND hidden_at IS NULL"}
     ORDER BY hidden_at IS NOT NULL, position, id`,
    [pizzeriaIds],
  );
  return rows as unknown as MenuRow[];
}

/** The pizzeria's live menu, which new picks come from (E7). */
export async function liveMenu(c: SqlClient, pizzeriaId: string) {
  const all = await menuEntries(c, [pizzeriaId]);
  return {
    items: all.filter((e) => e.kind === "item"),
    base: all.find((e) => e.kind === "base") ?? null,
    toppings: all.filter((e) => e.kind === "topping"),
  };
}

export interface Actor {
  user_id: string;
  name: string;
}

/** One line of the order's own history (D16). */
export async function logStep(
  c: SqlClient,
  orderId: string,
  at: Date,
  actor: Actor | null,
  kind: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await c.query(
    `INSERT INTO pizza_order_log (order_id, at, actor_user_id, actor_name, kind, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [orderId, at, actor?.user_id ?? null, actor?.name ?? null, kind, JSON.stringify(detail)],
  );
}
