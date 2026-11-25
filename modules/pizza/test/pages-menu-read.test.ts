/**
 * Reading a menu on the crew's pages (#789 items 1–6 and 15, mockup 11 D): the camera and up to
 * six pages with the cost shown first, real progress for the page's script, and the result as an
 * editable table (rows added, deleted and merged, more pages read in, the import's preview) that
 * travels in the page's form, with the CSV still there to download or paste.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DEMO_MENU_ROWS } from "../src/fake-menu.js";
import { applyCategories } from "../src/menu-rows.js";
import { tableFields, tableOf } from "../src/pages/menu-table.js";
import { estimate } from "../src/pages/menu-read-views.js";
import type { MenuRow } from "../src/reader.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { DATABASE_URL, TRUNCATE, freshDatabase, json, seedPizzerias, world } from "./helpers.js";
import type { World } from "./helpers.js";
import { form, upload, view } from "./forms.js";
import { png } from "./images.js";

let pool: pg.Pool;
let w: World;
let pz: string;
const KEY = "sk-ant-demo-key-0000wxyz";

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
  w.settings.set("demo", { ...DEFAULT_SETTINGS, ai_reader: true });
  ({ pz } = await seedPizzerias(w));
  await w.call("organiser", "PUT", "/api/pizza/reader/key", { api_key: KEY });
});

const page = () => `/crew/pizzerias/${pz}/read`;
const table = () => `/crew/pizzerias/${pz}/read/table`;
const photo = async (name = "page.png") => ({ name, type: "image/png", bytes: await png() });
/** The page's text with the apostrophes and quotes the template escapes put back. */
const text = (body: string) => body.replace(/&#39;/g, "'").replace(/&quot;/g, '"');
/** The table's rows as the page's form carries them (the read of both pages of the menu). */
const read = (): MenuRow[] => applyCategories(DEMO_MENU_ROWS);
const rowCount = (body: string) => new Set(body.match(/name="row\[\d+\]\[name\]"/g)).size;

describe("the table's form", () => {
  it("gives back the rows, notes and marked prices it carried", () => {
    const t = {
      rows: read(),
      notes: [{ kind: "lunch" as const, text: "Lounas", page: 1 }],
      conflicts: [2],
    };
    const back = tableOf(tableFields(t));
    expect(back).toEqual(t);
  });

  it("reads rows by their indices, so a row the script deleted in place leaves no hole", () => {
    const all = tableFields({ rows: read().slice(0, 3), notes: [], conflicts: [2] });
    const back = tableOf(
      Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith("row[1]"))),
    );
    expect(back.rows.map((r) => r.number)).toEqual(["1", "3"]);
    expect(back.conflicts).toEqual([1]);
  });
});

describe.skipIf(!DATABASE_URL)("the menu read's form (items 1 and 15)", () => {
  it("offers the camera on a phone and the image picker on a pointer", async () => {
    const r = text((await view(w, "organiser", page())).body);
    expect(r).toMatch(
      /pizza-only-touch[\s\S]*Take a photo of the menu[\s\S]*capture="environment"/,
    );
    expect(r).toMatch(/pizza-only-pointer[\s\S]*Attach images of the menu[\s\S]*multiple/);
  });

  it("has Add another page for the script, up to 6 pages", async () => {
    const r = (await view(w, "organiser", page())).body;
    expect(r).toMatch(/<button[^>]*data-add-page[^>]*hidden/);
    expect(r).toContain('data-max-pages="6"');
    expect(r).toContain("Add another page");
  });

  it("shows the cost before the read: about $0.0015 a page", async () => {
    const r = text((await view(w, "organiser", page())).body);
    expect(r).toContain("About $0.0015 a page");
    expect(r).toContain('data-estimate="About {cost} for {n} pages"');
    expect(estimate(1)).toBe("$0.0015");
    expect(estimate(3)).toBe("$0.0045");
  });

  it("refuses a seventh page with a message, reading nothing", async () => {
    const seven = await Promise.all(Array.from({ length: 7 }, (_, i) => photo(`p${i}.png`)));
    const r = await upload(w, "organiser", page(), seven);
    expect(r.statusCode).toBe(303);
    expect(r.headers.location).toContain("failed=too_many_pages");
    const shown = text((await view(w, "organiser", String(r.headers.location).slice(6))).body);
    expect(shown).toContain("A menu read takes at most 6 pages.");
    expect(w.reader.sent).toHaveLength(0);
  });

  it("sends all pages to the reader in one read", async () => {
    const r = await upload(w, "organiser", page(), [await photo(), await photo()]);
    expect(r.statusCode).toBe(200);
    expect(w.reader.menuCalls).toEqual([2]);
  });
});

describe.skipIf(!DATABASE_URL)("the read as a table (items 3–6)", () => {
  it("shows number, name, toppings, price, category and page per row", async () => {
    const r = text((await upload(w, "organiser", page(), [await photo(), await photo()])).body);
    expect(r).toContain("Read 11 items · check them first");
    for (const head of ["Number", "Name", "Toppings", "Price", "Category", "Page"])
      expect(r).toContain(`>${head}</th>`);
    expect(r).toContain('name="row[0][number]" value="1"');
    expect(r).toContain('name="row[0][name]" value="Demo Margherita"');
    expect(r).toContain('name="row[0][price]" value="9.00"');
    expect(r).toMatch(/value="27"[\s\S]*?name="row\[\d+\]\[page\]" value="2"/);
  });

  it("marks unsure values, prices taken from the category, and the notes it did not apply", async () => {
    const r = text((await upload(w, "organiser", page(), [await photo(), await photo()])).body);
    // Item 26 was unsure; 21–27 take the heading's price.
    expect(r).toMatch(/<tr[^>]*pizza-unsure[^>]*>[\s\S]*?value="26"/);
    expect(r).toMatch(/value="21"[\s\S]*?From the category/);
    expect(r).toContain("Not applied: Kampanja 14.6–15.9: kaikki pizzat 11,90€ (page 1)");
    expect(r).toContain("Not applied: Lounaspizza ma–pe 10–14 9,90€ (page 1)");
  });

  it("shows the own pizza and the toppings gathered from the pizzas, for the crew to confirm", async () => {
    const r = text((await upload(w, "organiser", page(), [await photo(), await photo()])).body);
    expect(r).toContain("Includes toppings");
    expect(r).toMatch(/name="row\[\d+\]\[included\]" value="3"/);
    expect(r).toContain("Gathered from the pizzas' toppings: confirm each, or delete it");
    expect(r).toMatch(/<tr[^>]*pizza-unsure[^>]*>[\s\S]*?value="Kinkku"/);
    expect(r).toMatch(/name="row\[\d+\]\[tier\]"[\s\S]*?<option value="special" selected/);
  });

  it("adds, deletes and merges rows without a script", async () => {
    const fields = tableFields({ rows: read(), notes: [], conflicts: [] });
    const n = read().length;
    const added = await form(w, "organiser", table(), { ...fields, do: "add" });
    expect(added.statusCode).toBe(200);
    expect(rowCount(added.body)).toBe(n + 1);
    const deleted = text((await form(w, "organiser", table(), { ...fields, do: "delete:0" })).body);
    expect(rowCount(deleted)).toBe(n - 1);
    expect(deleted).not.toContain("Demo Margherita");
    // Merge the second row into the first: the first's values stay, the second goes.
    const merged = text((await form(w, "organiser", table(), { ...fields, do: "merge:0:1" })).body);
    expect(rowCount(merged)).toBe(n - 1);
    expect(merged).toContain('value="Demo Margherita"');
    expect(merged).not.toContain('value="Demo Kinkku"');
  });

  it("keeps what the crew typed, reading Finnish prices", async () => {
    const fields = tableFields({ rows: read(), notes: [], conflicts: [] });
    const r = text(
      (
        await form(w, "organiser", table(), {
          ...fields,
          "row[0][name]": "Demo Margarita",
          "row[0][price]": "€ 9,50",
          do: "add",
        })
      ).body,
    );
    expect(r).toContain('name="row[0][name]" value="Demo Margarita"');
    expect(r).toContain('name="row[0][price]" value="9.50"');
  });

  it("reads only the new photos on Add more pages, merging duplicates and marking a different price", async () => {
    const fields = tableFields({ rows: read(), notes: [], conflicts: [] });
    w.reader.menu = [
      { ...(read()[1] as MenuRow), price_cents: 1100, price_from_category: false },
      { ...(read()[0] as MenuRow), number: "40", name: "Demo Uusi" },
    ];
    w.reader.menuNotes = [];
    const r = await upload(w, "organiser", table(), [await photo()], { ...fields, do: "more" });
    expect(r.statusCode).toBe(200);
    expect(w.reader.menuCalls).toEqual([1]);
    const body = text(r.body);
    expect(rowCount(body)).toBe(read().length + 1);
    // The new page comes after the two read before.
    expect(body).toMatch(/value="40"[\s\S]*?name="row\[\d+\]\[page\]" value="3"/);
    expect(body).toMatch(
      /name="row\[1\]\[price\]" value="10.50"[^>]*pizza-unsure|pizza-unsure[^>]*name="row\[1\]\[price\]" value="10.50"/,
    );
    expect(body).toContain("A page read again gave another price: check the marked prices.");
  });

  it("keeps the posted table when Add more pages gets a seventh photo, and says why", async () => {
    const fields = tableFields({ rows: read(), notes: [], conflicts: [] });
    const seven = await Promise.all(Array.from({ length: 7 }, (_, i) => photo(`p${i}.png`)));
    const r = await upload(w, "organiser", table(), seven, { ...fields, do: "more" });
    const body = text(r.body);
    expect(rowCount(body)).toBe(read().length);
    expect(body).toContain("A menu read takes at most 6 pages.");
    expect(w.reader.menuCalls).toEqual([]);
  });

  it("reads 5 pages sent with the two empty file parts of the unused inputs", async () => {
    const five = await Promise.all(Array.from({ length: 5 }, (_, i) => photo(`p${i}.png`)));
    const empty = { name: "", type: "application/octet-stream", bytes: Buffer.alloc(0) };
    const r = await upload(w, "organiser", page(), [...five, empty, empty]);
    expect(r.statusCode).toBe(200);
    expect(w.reader.menuCalls).toEqual([5]);
  });

  it("posts the table as a menu CSV to the import's preview, which changes nothing", async () => {
    const fields = tableFields({ rows: read(), notes: [], conflicts: [] });
    const r = text((await form(w, "organiser", table(), { ...fields, do: "check" })).body);
    expect(r.match(/Demo Pizzeria/g)?.length).toBeGreaterThan(0);
    expect(r).toContain("was Margherita");
    expect(r).toContain("not in the file: hidden, old orders keep it");
    expect(r).toContain("Apply");
    const menu = json(await w.call("menus", "GET", `/api/pizza/pizzerias/${pz}`)).menu as {
      items: { number: string; name: string }[];
    };
    expect(menu.items.find((i) => i.number === "1")?.name).toBe("Margherita");
  });

  it("checks against the menu as it is now when another import came in between, and applies nothing", async () => {
    const fields = tableFields({ rows: read(), notes: [], conflicts: [] });
    await w.call("menus", "PUT", `/api/pizza/pizzerias/${pz}/menu`, {
      items: [{ number: "1", name: "Changed meanwhile", price: 700 }],
    });
    const r = text((await form(w, "organiser", table(), { ...fields, do: "check" })).body);
    expect(r).toContain("was Changed meanwhile");
    const menu = json(await w.call("menus", "GET", `/api/pizza/pizzerias/${pz}`)).menu as {
      items: { number: string; name: string }[];
    };
    expect(menu.items.map((i) => i.name)).toEqual(["Changed meanwhile"]);
  });

  it("keeps the CSV: a download and the text to edit and import", async () => {
    const r = (await upload(w, "organiser", page(), [await photo()])).body;
    expect(r).toContain('download="menu.csv"');
    expect(r).toContain("data:text/csv;charset=utf-8,pizzeria%2Ckind%2Cnumber");
    expect(r).toMatch(
      /<form[^>]*action="\/pizza\/crew\/pizzerias\/import"[\s\S]*?<textarea[^>]*name="csv"/,
    );
  });

  it("is the menu writers'", async () => {
    const fields = tableFields({ rows: read(), notes: [], conflicts: [] });
    expect((await form(w, "pena", table(), { ...fields, do: "add" })).statusCode).toBe(403);
  });
});

describe.skipIf(!DATABASE_URL)("progress for the page's script (item 2)", () => {
  const NDJSON = { accept: "application/x-ndjson" };
  const lines = (body: string) =>
    body
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  it("answers the server's steps as it takes them, then the table to show", async () => {
    const r = await upload(
      w,
      "organiser",
      page(),
      [await photo(), await photo()],
      {},
      "photo",
      NDJSON,
    );
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("application/x-ndjson");
    const [reading, checking, done] = lines(r.body);
    expect(reading).toEqual({ phase: "reading", pages: 2, seconds: 20 });
    expect(checking).toEqual({ phase: "checking" });
    const post = (done as { post: { action: string; fields: Record<string, string> } }).post;
    expect(post.action).toBe(`/pizza/crew/pizzerias/${pz}/read/table`);
    expect(post.fields).toMatchObject({ do: "show", "row[0][number]": "1", "row[0][page]": "1" });
    // The post shows the table without reading again.
    const shown = await form(w, "organiser", table(), post.fields);
    expect(text(shown.body)).toContain("Read 11 items · check them first");
    expect(w.reader.menuCalls).toEqual([2]);
  });

  it("says where to go when the read failed", async () => {
    w.reader.fail = "timeout";
    const r = await upload(w, "organiser", page(), [await photo()], {}, "photo", NDJSON);
    const last = lines(r.body).at(-1) as { location: string };
    expect(last.location).toBe(`/pizza/crew/pizzerias/${pz}/read?failed=timeout`);
    const shown = text((await view(w, "organiser", last.location.slice(6))).body);
    expect(shown).toContain("The reader took too long.");
  });
});
