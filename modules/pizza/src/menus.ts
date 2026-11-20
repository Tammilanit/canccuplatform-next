/**
 * Replacing a pizzeria's menu, from the JSON menu, the menu CSV or the profile: items matched by
 * number are updated (a hidden one comes back), new ones added, the pizzeria's items missing from
 * the menu hidden, never deleted (the legacy rule); the base and toppings are replaced as a set.
 * Ordered rows keep their snapshot (D15). The preview runs the same plan without writing.
 */
import type { SqlClient } from "@canccu/kit";
import { newId } from "./ids.js";
import type { MenuInput } from "./model.js";
import { menuEntries } from "./store.js";
import type { MenuRow } from "./store.js";

export interface MenuCounts {
  added: number;
  updated: number;
  hidden: number;
}

type Line = { name: string; description: string | null; price_cents: number | null };
type Write =
  | { op: "insert"; kind: MenuRow["kind"]; number: string | null; line: Line; position: number }
  | { op: "update"; id: string; number: string | null; line: Line; position: number }
  | { op: "hide"; id: string };

export function planMenu(
  existing: MenuRow[],
  input: MenuInput,
): { writes: Write[]; items: MenuCounts } {
  const writes: Write[] = [];
  const items: MenuCounts = { added: 0, updated: 0, hidden: 0 };
  const byNumber = (n: string) =>
    existing.find((e) => e.kind === "item" && e.number === n && !e.hidden) ??
    existing.find((e) => e.kind === "item" && e.number === n);
  const kept = new Set<string>();
  input.items.forEach((it, position) => {
    const hit = byNumber(it.number);
    if (hit === undefined) {
      writes.push({ op: "insert", kind: "item", number: it.number, line: it, position });
      items.added++;
    } else {
      kept.add(hit.id);
      writes.push({ op: "update", id: hit.id, number: it.number, line: it, position });
      items.updated++;
    }
  });
  // Hides first: a pizzeria has one visible base, and a topping's name once.
  const hides: Write[] = [];
  for (const e of existing) {
    if (e.hidden) continue;
    if (e.kind === "item" && !kept.has(e.id)) {
      hides.push({ op: "hide", id: e.id });
      items.hidden++;
    }
  }
  const sets: Write[] = [];
  const setEntries = [
    ...(input.base === null ? [] : [{ kind: "base" as const, line: input.base }]),
    ...input.toppings.map((t) => ({ kind: "topping" as const, line: t })),
  ];
  const keptSet = new Set<string>();
  setEntries.forEach(({ kind, line }, position) => {
    const hit = existing.find(
      (e) => e.kind === kind && !e.hidden && e.name.toLowerCase() === line.name.toLowerCase(),
    );
    if (hit === undefined || keptSet.has(hit.id))
      sets.push({ op: "insert", kind, number: null, line, position });
    else {
      keptSet.add(hit.id);
      sets.push({ op: "update", id: hit.id, number: null, line, position });
    }
  });
  for (const e of existing) {
    if (!e.hidden && e.kind !== "item" && !keptSet.has(e.id)) hides.push({ op: "hide", id: e.id });
  }
  return { writes: [...hides, ...writes, ...sets], items };
}

export async function applyMenu(
  c: SqlClient,
  pizzeriaId: string,
  input: MenuInput,
  now: Date,
): Promise<MenuCounts> {
  const { writes, items } = planMenu(await menuEntries(c, [pizzeriaId], true), input);
  for (const w of writes) {
    if (w.op === "hide") {
      await c.query(`UPDATE pizza_menu_entries SET hidden_at = $2 WHERE id = $1`, [w.id, now]);
    } else if (w.op === "update") {
      await c.query(
        `UPDATE pizza_menu_entries SET name = $2, description = $3, price_cents = $4, position = $5, hidden_at = NULL
         WHERE id = $1`,
        [w.id, w.line.name, w.line.description, w.line.price_cents, w.position],
      );
    } else {
      await c.query(
        `INSERT INTO pizza_menu_entries (id, pizzeria_id, kind, number, name, description, price_cents, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          newId("mi"),
          pizzeriaId,
          w.kind,
          w.number,
          w.line.name,
          w.line.description,
          w.line.price_cents,
          w.position,
        ],
      );
    }
  }
  return items;
}

/** A pizzeria's menu as the API, the CSV and the profile give it. */
export function menuInputOf(entries: MenuRow[]): MenuInput {
  const visible = entries.filter((e) => !e.hidden);
  const line = (e: MenuRow) => ({
    name: e.name,
    description: e.description,
    price_cents: e.price_cents,
  });
  const base = visible.find((e) => e.kind === "base");
  return {
    items: visible
      .filter((e) => e.kind === "item")
      .map((e) => ({ number: e.number ?? "", ...line(e) })),
    base: base === undefined ? null : line(base),
    toppings: visible.filter((e) => e.kind === "topping").map(line),
  };
}
