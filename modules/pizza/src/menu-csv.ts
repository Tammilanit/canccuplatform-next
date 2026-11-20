/**
 * The menu CSV (contracts/pizza.md, The menu CSV): one file anyone can make, by hand, from a
 * spreadsheet or with an AI tool, that a preview checks before it replaces any menu. An error names
 * its row (the header is row 1) and column and stops the import; a warning does not.
 */
import { CsvSyntax, csvLine, euros, readCsv } from "./csv.js";
import type { MenuInput, Service } from "./model.js";
import { LIMITS } from "./validate.js";

export const COLUMNS = [
  "pizzeria",
  "phone",
  "website",
  "service",
  "kind",
  "number",
  "name",
  "description",
  "price",
] as const;
type Column = (typeof COLUMNS)[number];

export const MAX_ROWS = 1000;
export const MAX_BYTES = 512 * 1024;

export interface Issue {
  row: number | null;
  column: string | null;
  message: string;
}

export interface MenuFilePizzeria {
  name: string;
  phone: string | null;
  website: string | null;
  /** null where the file leaves it empty: a new pizzeria then delivers, a stored one keeps its own. */
  service: Service | null;
  menu: MenuInput;
}

export interface MenuFile {
  pizzerias: MenuFilePizzeria[];
  errors: Issue[];
  warnings: Issue[];
}

const PRICE = /^\d{1,3}(\.\d{1,2})?$/;

function cents(text: string): number {
  const [whole = "0", frac = ""] = text.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

function isWebUrl(text: string): boolean {
  try {
    const u = new URL(text);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

interface Building extends MenuFilePizzeria {
  /** Where each of phone, website and service was first given, to say where a clash is. */
  firstAt: Partial<Record<"phone" | "website" | "service", number>>;
  numbers: Map<string, number>;
}

export function parseMenuCsv(text: string): MenuFile {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const groups = new Map<string, Building>();
  const out = (): MenuFile => ({
    pizzerias: errors.length ? [] : [...groups.values()].map(strip),
    errors,
    warnings,
  });
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
    errors.push({ row: null, column: null, message: "at most 512 KiB" });
    return out();
  }
  let records: string[][];
  try {
    records = readCsv(text.startsWith("﻿") ? text.slice(1) : text);
  } catch (err) {
    const row = err instanceof CsvSyntax ? err.row : null;
    errors.push({ row, column: null, message: err instanceof Error ? err.message : "not a CSV" });
    return out();
  }
  const [header = [], ...rows] = records;
  if (rows.length > MAX_ROWS) {
    errors.push({ row: null, column: null, message: `at most ${MAX_ROWS} rows` });
    return out();
  }
  const index = new Map<Column, number>();
  header.forEach((raw, i) => {
    const name = raw.trim().toLowerCase();
    if (!(COLUMNS as readonly string[]).includes(name)) {
      warnings.push({ row: 1, column: name, message: "unknown column, ignored" });
    } else if (index.has(name as Column)) {
      errors.push({ row: 1, column: name, message: "column given twice" });
    } else index.set(name as Column, i);
  });
  for (const need of ["pizzeria", "name"] as const) {
    if (!index.has(need)) errors.push({ row: 1, column: need, message: "missing column" });
  }
  if (errors.length) return out();

  rows.forEach((fields, i) => {
    const row = i + 2;
    if (fields.length !== header.length) {
      errors.push({
        row,
        column: null,
        message: `${header.length} fields expected, found ${fields.length}`,
      });
      return;
    }
    const at = (c: Column) => {
      const k = index.get(c);
      return k === undefined ? "" : (fields[k] ?? "").trim();
    };
    const fail = (column: Column, message: string) => {
      errors.push({ row, column, message });
    };
    const before = errors.length;
    const pizzeria = at("pizzeria");
    if (!pizzeria) fail("pizzeria", "required");
    else if (pizzeria.length > LIMITS.pizzeria)
      fail("pizzeria", `at most ${LIMITS.pizzeria} characters`);
    const name = at("name");
    if (!name) fail("name", "required");
    else if (name.length > LIMITS.name) fail("name", `at most ${LIMITS.name} characters`);
    const kind = at("kind") || "item";
    if (!["item", "base", "topping"].includes(kind)) fail("kind", "item, base or topping");
    const number = at("number");
    if (kind === "item" && !number) fail("number", "an item needs its menu number");
    if (kind !== "item" && number) fail("number", "only items have a menu number");
    if (number.length > LIMITS.number) fail("number", `at most ${LIMITS.number} characters`);
    const description = at("description");
    if (description.length > LIMITS.description)
      fail("description", `at most ${LIMITS.description} characters`);
    const price = at("price");
    if (price && !PRICE.test(price))
      fail("price", "a dot decimal from 0 to 999.99, at most two decimals, no sign");
    const phone = at("phone");
    if (phone.length > LIMITS.phone) fail("phone", `at most ${LIMITS.phone} characters`);
    const website = at("website");
    if (website && !isWebUrl(website)) fail("website", "an http or https URL");
    const service = at("service");
    if (service && service !== "delivery" && service !== "takeaway")
      fail("service", "delivery or takeaway");
    if (errors.length > before) return;

    const key = pizzeria.toLowerCase();
    const g: Building = groups.get(key) ?? {
      name: pizzeria,
      phone: null,
      website: null,
      service: null,
      menu: { items: [], base: null, toppings: [] },
      firstAt: {},
      numbers: new Map(),
    };
    groups.set(key, g);
    for (const [col, value] of [
      ["phone", phone],
      ["website", website],
      ["service", service],
    ] as const) {
      if (!value) continue;
      const first = g.firstAt[col];
      if (first === undefined) {
        g.firstAt[col] = row;
        if (col === "service") g.service = value as Service;
        else g[col] = value;
      } else if ((col === "service" ? g.service : g[col]) !== value) {
        fail(col, `differs from row ${first} of ${g.name}`);
      }
    }
    const entry = {
      name,
      description: description || null,
      price_cents: price ? cents(price) : null,
    };
    if (kind === "item") {
      const seen = g.numbers.get(number);
      if (seen !== undefined) {
        fail("number", `${number} is already on row ${seen}`);
        return;
      }
      g.numbers.set(number, row);
      g.menu.items.push({ number, ...entry });
    } else if (kind === "base") {
      if (g.menu.base !== null) {
        fail("kind", `${g.name} already has a base`);
        return;
      }
      g.menu.base = entry;
    } else {
      if (g.menu.toppings.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
        fail("name", `${name} is already a topping of ${g.name}`);
        return;
      }
      g.menu.toppings.push(entry);
    }
    if (!price) warnings.push({ row, column: "price", message: `${name} has no price` });
  });
  return out();
}

function strip(g: Building): MenuFilePizzeria {
  return { name: g.name, phone: g.phone, website: g.website, service: g.service, menu: g.menu };
}

/** The download: the same columns, phone, web page and service on each pizzeria's first row. */
export function writeMenuCsv(pizzerias: MenuFilePizzeria[]): string {
  const lines = [COLUMNS.join(",")];
  const price = (c: number | null) => (c === null ? "" : euros(c));
  for (const p of pizzerias) {
    let first = true;
    const row = (
      kind: string,
      number: string,
      e: { name: string; description: string | null; price_cents: number | null },
    ) => {
      const head = first
        ? [p.name, p.phone ?? "", p.website ?? "", p.service ?? ""]
        : [p.name, "", "", ""];
      first = false;
      lines.push(
        csvLine([...head, kind, number, e.name, e.description ?? "", price(e.price_cents)]),
      );
    };
    for (const it of p.menu.items) row("item", it.number, it);
    if (p.menu.base !== null) row("base", "", p.menu.base);
    for (const t of p.menu.toppings) row("topping", "", t);
  }
  return `${lines.join("\n")}\n`;
}
