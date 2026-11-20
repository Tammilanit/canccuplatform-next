/** The legacy `pizza-summary` and `pizza-menu-filter` tests, ported to rows that keep their snapshot. */
import { describe, expect, it } from "vitest";
import { menuMatches } from "../src/menu-filter.js";
import { buildSummary } from "../src/summary.js";
import type { SummaryItem } from "../src/summary.js";

const kebab = { name: "Kebab", description: "kebab, sipuli, jalapeño" };

describe("menuMatches", () => {
  it("matches through the description", () => {
    expect(menuMatches(kebab, "jalap")).toBe(true);
  });
  it("is case-insensitive", () => {
    expect(menuMatches({ name: "Kebab", description: null }, "KEBAB")).toBe(true);
  });
  it("matches everything on an empty query", () => {
    expect(menuMatches({ name: "X", description: null }, "  ")).toBe(true);
  });
  it("is false when nothing matches", () => {
    expect(menuMatches(kebab, "ananas")).toBe(false);
  });
});

const row = (name: string, o: Partial<SummaryItem>): SummaryItem => ({
  name,
  kind: "menu",
  number: null,
  label: "",
  note: null,
  comment: null,
  ...o,
});
const menu = (n: string, label: string) => ({ number: n, label: `#${n} ${label}` });

describe("buildSummary", () => {
  const items = [
    row("Pena", menu("3", "Pepperoni")),
    row("Pena", { ...menu("3", "Pepperoni"), note: "no onion", comment: "split with Anni" }),
    row("Anni", menu("12", "Kebab")),
    row("Anni", menu("1", "Margherita")),
    row("Mikko", menu("12", "Kebab")),
    row("Mikko", { kind: "custom", label: "Oma pizza: kinkku, ananas" }),
    row("Tero", { kind: "text", label: "Other: XL family", note: "half pepperoni" }),
  ];
  const s = buildSummary({ day: "2026-10-29", seq: 1, pizzeria: "Demo Pizzeria" }, items);

  it("orders menu items by number, gives a noted pizza its own line, lists the rest one by one", () => {
    expect(s.text).toBe(
      [
        "Demo Pizzeria · Thu 29.10. · order 1 · 7 pizzas",
        "",
        "1 × #1 Margherita",
        "1 × #3 Pepperoni",
        "1 × #3 Pepperoni — no onion",
        "2 × #12 Kebab",
        "1 × Oma pizza: kinkku, ananas",
        "1 × Other: XL family — half pepperoni",
        "",
        "Who: Anni (2), Mikko (2), Pena (2), Tero",
      ].join("\n"),
    );
    expect(s.pizza_count).toBe(7);
    expect(s.lines[3]).toEqual({ count: 2, label: "#12 Kebab", note: null });
  });
  it("never shows comments", () => {
    expect(JSON.stringify(s)).not.toContain("split with");
  });
  it("sorts 12a after 12 and says one pizza in the singular", () => {
    const one = buildSummary({ day: "2026-10-29", seq: 2, pizzeria: "P" }, [
      row("A", menu("12a", "Kebab XL")),
    ]);
    expect(one.header).toBe("P · Thu 29.10. · order 2 · 1 pizza");
    const two = buildSummary({ day: "2026-10-29", seq: 2, pizzeria: "P" }, [
      row("A", menu("12a", "Kebab XL")),
      row("B", menu("12", "Kebab")),
    ]);
    expect(two.lines.map((l) => l.label)).toEqual(["#12 Kebab", "#12a Kebab XL"]);
  });
});
