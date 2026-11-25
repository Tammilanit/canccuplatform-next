/**
 * The fake reader's menu (#789 items 4–6 and 15): a synthetic menu laid out as a real two-column
 * one is, never a real pizzeria's. Its left column ends inside a category whose heading carries
 * the price ("Demo-/Kebab-/Kana-pizzat 13,90€") and whose last items open the right column and the
 * next page; a dated campaign box and a lunch line are notes, never prices; the own pizza is a
 * "choose 3 toppings" base with a line of special toppings, and the menu lists no normal toppings,
 * so they are gathered from the pizzas' ingredients (Finnish forms: "kinkku, ananas ja
 * aurajuusto"). The tests and the CI stack's shots read it.
 */
import type { MenuNote, MenuRow } from "./reader.js";

const row = (o: Partial<MenuRow> & Pick<MenuRow, "name">): MenuRow => ({
  page: 1,
  kind: "item",
  number: null,
  description: null,
  price_cents: null,
  category: null,
  category_price_cents: null,
  included_toppings: null,
  extra_topping_cents: null,
  tier: null,
  unsure: false,
  ...o,
});

const CATEGORY = "Demo-/Kebab-/Kana-pizzat";
const priced = (number: string, name: string, description: string, price: number): MenuRow =>
  row({ number, name, description, price_cents: price, category: "Classics" });
const inCategory = (number: string, name: string, description: string, page = 1): MenuRow =>
  row({ page, number, name, description, category: CATEGORY });

export const DEMO_MENU_ROWS: MenuRow[] = [
  // The left column: the classics with their own prices, then the category with its price.
  priced("1", "Demo Margherita", "tomaatti, juusto", 900),
  priced("2", "Demo Kinkku", "kinkku, juusto", 1050),
  priced("3", "Demo Hawaii", "kinkku, ananas ja aurajuusto", 1150),
  { ...inCategory("21", "Demo Kebab", "kebab, sipuli ja jalapeno"), category_price_cents: 1390 },
  { ...inCategory("22", "Demo Kana", "kana, ananas"), category_price_cents: 1390 },
  { ...inCategory("23", "Demo Poro", "poro, sipuli, aurajuusto"), category_price_cents: 1390 },
  {
    ...inCategory("24", "Demo Kebab Special", "kebab, kinkku ja salami"),
    category_price_cents: 1390,
  },
  // The right column's top: the same category, its heading not repeated.
  inCategory("25", "Demo Kana Special", "kana, salami ja aurajuusto"),
  { ...inCategory("26", "Demo Tuplakebab", "kebab, kebab, sipuli"), unsure: true },
  // The own pizza: three toppings included, more at a price, special toppings dearer.
  row({
    kind: "base",
    name: "Demo Fantasia",
    description: "valitse 3 täytettä",
    price_cents: 1000,
    included_toppings: 3,
    extra_topping_cents: 150,
  }),
  row({ kind: "topping", name: "Katkarapu", price_cents: 250, tier: "special" }),
  row({ kind: "topping", name: "Mozzarella", price_cents: 250, tier: "special" }),
  // The next page: the category still runs.
  inCategory("27", "Demo Kebab Deluxe", "kebab, kinkku, ananas", 2),
  row({
    page: 2,
    number: "30",
    name: "Demo Calzone",
    description: "kinkku, salami",
    price_cents: 1200,
  }),
];

export const DEMO_MENU_NOTES: MenuNote[] = [
  { kind: "campaign", text: "Kampanja 14.6–15.9: kaikki pizzat 11,90€", page: 1 },
  { kind: "lunch", text: "Lounaspizza ma–pe 10–14 9,90€", page: 1 },
];
