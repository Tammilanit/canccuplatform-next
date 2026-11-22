/**
 * The holder's money pages (#644; mockups 18, 19 and 09) on the server, and each person's own
 * amount on My order: every form the API's own write, the reader only where it is on, and each
 * person seeing only their own amount and mark.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import {
  DATABASE_URL,
  TRUNCATE,
  freshDatabase,
  itemId,
  json,
  open,
  seedPizzerias,
  world,
} from "./helpers.js";
import type { World } from "./helpers.js";
import { form, upload, view } from "./forms.js";
import { png } from "./images.js";

let pool: pg.Pool;
let w: World;
let pz: string;
let id: string;

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
    ["anni", "12"],
    ["anni", "12"],
    ["mikko", "1"],
    ["pena", "3"],
  ] as const) {
    await w.call(who, "POST", `/api/pizza/orders/${id}/items`, {
      kind: "menu",
      menu_item_id: await itemId(w, pz, number),
    });
  }
  await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
});

const money = async () => json(await w.call("pena", "GET", `/api/pizza/orders/${id}/money`));
const location = (r: { headers: Record<string, unknown> }) => String(r.headers.location);
const turnOnReader = async () => {
  w.settings.set("demo", { ...DEFAULT_SETTINGS, settle_to_payer: true, ai_reader: true });
  await w.call("integrator", "PUT", "/api/pizza/reader/key", {
    api_key: "sk-ant-demo-key-0000wxyz",
  });
};

describe.skipIf(!DATABASE_URL)("the order's money, for the holder (mockups 18 A, D and 19)", () => {
  it("asks for the total, and says nothing of a reader that is off", async () => {
    const r = await view(w, "pena", `/hold/${id}/money`);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Add the receipt");
    expect(r.body).toContain("Type the total");
    expect(r.body).toContain("Add a photo (kept, not read)");
    expect(r.body).toContain("Menu prices add up to €36.00");
    expect(r.body).not.toContain("Anthropic");
  });

  it("names the outside service before a photo is sent, when the reader is on", async () => {
    await turnOnReader();
    const r = await view(w, "pena", `/hold/${id}/money`);
    expect(r.body).toContain("Scan the receipt");
    expect(r.body).toContain("The photo goes to Anthropic to be read.");
    expect((await view(w, "pena", `/hold/${id}/money/scan`)).body).toContain(
      "The photo goes to Anthropic to be read.",
    );
  });

  it("takes the total on the amount pad, never on steppers", async () => {
    const pad = await view(w, "pena", `/hold/${id}/money/total`);
    expect(pad.body).toContain('inputmode="decimal"');
    expect(pad.body).toContain('data-pad-key="7"');
    expect(pad.body).not.toContain('type="number"');
    const r = await form(w, "pena", `/hold/${id}/money/total`, { total: "38,50" });
    expect(location(r)).toBe(`/pizza/hold/${id}/money`);
    expect(await money()).toMatchObject({ total_cents: 3850, total_receipt_id: null });
    const page = (await view(w, "pena", `/hold/${id}/money`)).body;
    expect(page).toContain("€38.50 paid by you");
    expect(page).toContain("total typed in");
  });

  it("refuses a total that is not an amount, in words", async () => {
    const r = await form(w, "pena", `/hold/${id}/money/total`, { total: "lots" });
    expect(location(r)).toContain(`/pizza/hold/${id}/money/total?error=`);
  });

  it("chooses exact or even, and shows each person's amount adding up to the total", async () => {
    await form(w, "pena", `/hold/${id}/money/total`, { total: "40.00" });
    let page = (await view(w, "pena", `/hold/${id}/money`)).body;
    expect(page).toContain("Prices + €4.00 extras, €1.00 a pizza");
    expect(page).toContain("€21.00");
    await form(w, "pena", `/hold/${id}/money/split`, { split: "even" });
    page = (await view(w, "pena", `/hold/${id}/money`)).body;
    expect(page).toContain("€40.00 ÷ 4 pizzas = €10.00 a pizza");
    expect((await money()).split).toBe("even");
  });

  it("asks for the price of a pizza without one, for exact amounts (mockup 19 D)", async () => {
    await w.call("pena", "POST", `/api/pizza/orders/${id}/undo`, {});
    await w.call("pena", "POST", `/api/pizza/orders/${id}/reopen`, {});
    await w.call("tero", "POST", `/api/pizza/orders/${id}/items`, {
      kind: "text",
      text: "garlic bread",
    });
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
    await form(w, "pena", `/hold/${id}/money/total`, { total: "40.00" });
    let page = (await view(w, "pena", `/hold/${id}/money`)).body;
    expect(page).toContain("1 pizza has no price");
    expect(page).toContain("Other: garlic bread");
    const tero = ((await money()).prices as { item_id: string; price_cents: number | null }[]).find(
      (p) => p.price_cents === null,
    );
    await form(w, "pena", `/hold/${id}/money/price`, {
      item_id: tero?.item_id ?? "",
      price: "3.50",
    });
    page = (await view(w, "pena", `/hold/${id}/money`)).body;
    expect(page).not.toContain("has no price");
  });

  it("lets the holder be paid directly, with Pay me with and Paid ticks (mockups 19 B, C)", async () => {
    await form(w, "pena", `/hold/${id}/money/total`, { total: "40.00" });
    let page = (await view(w, "pena", `/hold/${id}/money`)).body;
    expect(page).toContain("Me directly");
    await form(w, "pena", `/hold/${id}/money/settle`, { settle_to: "payer" });
    await form(w, "pena", `/hold/${id}/money/pay-with`, {
      mobilepay: "040 000 0000",
      iban: "FI21 1234 5600 0007 85",
    });
    page = (await view(w, "pena", `/hold/${id}/money`)).body;
    expect(page).toContain("MobilePay · 040 000 0000");
    expect(page).toContain("Bank · FI21 1234 5600 0007 85");
    // What is sent is a notice whom to pay; the details and amounts stay on each person's order (#703).
    expect(page).toMatch(/people in this order see these with their amount on their order\./);
    expect(page).toContain("Their notice says whom to pay, never these details.");
    expect(page).toContain("Who owes you");
    expect(page).toContain("€30.00 still to collect");
    await form(w, "pena", `/hold/${id}/paid`, { user_id: "u_anni", paid: "yes", back: "money" });
    page = (await view(w, "pena", `/hold/${id}/money`)).body;
    expect(page).toContain("€9.00 still to collect");
  });

  it("shows each person's pizzas and how their amount is made, with the Paid tick on the same row (H4, mockup 19 B)", async () => {
    await form(w, "pena", `/hold/${id}/money/total`, { total: "40.00" });
    await form(w, "pena", `/hold/${id}/money/settle`, { settle_to: "payer" });
    const page = (await view(w, "pena", `/hold/${id}/money`)).body;
    const table = page.slice(page.indexOf('<table class="pizza-table pizza-people-table"'));
    expect(table).toMatch(/Anni[\s\S]*#12 Kebab ×2[\s\S]*€19\.00 \+ €2\.00[\s\S]*€21\.00/);
    expect(table).toMatch(/Anni[\s\S]*?class="pizza-tick/);
    // One list of people: who owes you is a line over the table, not a second list of boxes.
    expect(page.match(/>Anni</g) ?? []).toHaveLength(1);
    expect(page).toContain("€30.00 still to collect");
    expect(page).not.toMatch(/class="pizza-card[ "]/);
    expect(page).not.toContain("pizza-split");
    // The total shows once, as the page's hero.
    expect(page.match(/€40\.00/g) ?? []).toHaveLength(1);
  });

  it("selects the split and who is paid on tap, one button per choice, no Save (mockup 19)", async () => {
    await form(w, "pena", `/hold/${id}/money/total`, { total: "40.00" });
    const page = (await view(w, "pena", `/hold/${id}/money`)).body;
    expect(page).toMatch(/<button[^>]*name="split"[^>]*value="even"/);
    expect(page).toMatch(/<button[^>]*name="split"[^>]*value="exact"[^>]*aria-pressed="true"/);
    expect(page).toMatch(/<button[^>]*name="settle_to"[^>]*value="payer"[^>]*aria-pressed="false"/);
    expect(page).not.toContain('type="radio"');
    expect(page).not.toMatch(/<button[^>]*>\s*Save\s*<\/button>/);
    await form(w, "pena", `/hold/${id}/money/settle`, { settle_to: "payer" });
    expect((await money()).settle_to).toBe("payer");
  });

  it("hides Me directly where the event settles through the organiser", async () => {
    w.settings.set("demo", DEFAULT_SETTINGS);
    expect((await view(w, "pena", `/hold/${id}/money`)).body).not.toContain("Me directly");
  });

  it("is the holder's and the crew's page, not a member's", async () => {
    expect(location(await view(w, "anni", `/hold/${id}/money`))).toBe(`/pizza/hold/${id}`);
    expect((await view(w, "crew", `/hold/${id}/money`)).statusCode).toBe(200);
  });
});

describe.skipIf(!DATABASE_URL)(
  "a receipt: the photo, the read, the confirm (mockup 18 B, C, E)",
  () => {
    it("reads the photo and asks the holder to check it; nothing counts before Confirm", async () => {
      await turnOnReader();
      w.reader.receipt = {
        total_cents: 3900,
        lines: [
          {
            text: "2 x 12 Kebab 19.00",
            number: "12",
            name: "Kebab",
            quantity: 2,
            amount_cents: 1900,
            kind: "item",
          },
          {
            text: "1 x 1 Margherita 8.50",
            number: "1",
            name: "Margherita",
            quantity: 1,
            amount_cents: 850,
            kind: "item",
          },
          {
            text: "1 x 3 Pepperoni 9.00",
            number: "3",
            name: "Pepperoni",
            quantity: 1,
            amount_cents: 900,
            kind: "item",
          },
          {
            text: "Delivery 4.00",
            number: null,
            name: "Delivery",
            quantity: 1,
            amount_cents: 400,
            kind: "extra",
          },
          {
            text: "Discount -1.50",
            number: null,
            name: "Discount",
            quantity: 1,
            amount_cents: -150,
            kind: "extra",
          },
        ],
      };
      const r = await upload(w, "pena", `/hold/${id}/money/scan`, [
        { name: "receipt.png", type: "image/png", bytes: await png() },
      ]);
      expect(location(r)).toMatch(new RegExp(`^/pizza/hold/${id}/money/check\\?receipt=pr_`));
      expect((await money()).total_cents).toBeNull();
      const check = (await view(w, "pena", location(r).replace("/pizza", ""))).body;
      expect(check).toContain("Check the read");
      expect(check).toContain("€39.00");
      expect(check).toContain("Menu said €8.00");
      expect(check).toContain("€9.50 each · as the menu");
      expect(check).toContain("Discount");
      expect(check).toContain("Adds up to €39.00 ✓");
      // H3: the photo beside the lines, the line to check first, and the sum by Confirm.
      expect(check).toMatch(/<img[^>]*src="\/api\/pizza\/receipts\/pr_[^"]*\/photo"/);
      expect(check).not.toContain("pizza-split");
      const lines = check.slice(check.indexOf('class="pizza-check__lines"'));
      expect(lines.indexOf("Menu said €8.00")).toBeLessThan(lines.indexOf("€9.50 each · as the menu"));
      const bar = check.slice(check.indexOf('class="pizza-checkbar"'));
      expect(bar).toMatch(/Adds up to €39\.00 ✓[\s\S]*Retake[\s\S]*Confirm/);
      const receipt = new URL(location(r), "http://x").searchParams.get("receipt") ?? "";
      const items = (await money()).prices as { item_id: string; label: string }[];
      const fields: Record<string, string> = { receipt_id: receipt, total: "39.00" };
      for (const i of items)
        fields[`price_${i.item_id}`] = i.label.includes("Margherita")
          ? "8.50"
          : i.label.includes("Kebab")
            ? "9.50"
            : "9.00";
      const done = await form(w, "pena", `/hold/${id}/money/check`, fields);
      expect(location(done)).toBe(`/pizza/hold/${id}/money`);
      expect(await money()).toMatchObject({ total_cents: 3900, total_receipt_id: receipt });
      const page = (await view(w, "pena", `/hold/${id}/money`)).body;
      expect(page).toContain("Total €39.00 confirmed");
      expect(page).toContain("by Pena at 18:00");
      expect(page).toContain("Receipt 1 · 18:00");
      expect(page).toContain("Seen by you, the crew and the organiser only");
    });

    it("offers the camera as a big button and a saved photo as the other way (mockup 18 B)", async () => {
      const page = (await view(w, "pena", `/hold/${id}/money/scan`)).body;
      expect(page).toContain("Take a photo of the receipt");
      expect(page).toContain("Use a saved photo");
      const inputs = page.match(/<input[^>]*type="file"[^>]*>/g) ?? [];
      expect(inputs).toHaveLength(3);
      expect(inputs.filter((i) => i.includes('capture="environment"'))).toHaveLength(1);
      expect(inputs.every((i) => !i.includes("required"))).toBe(true);
      expect(page).toContain("pizza-camera");
    });

    it("offers the camera on a phone only, and on a PC a file to attach or drop (H2)", async () => {
      await turnOnReader();
      const page = (await view(w, "pena", `/hold/${id}/money/scan`)).body;
      const phone = page.slice(page.indexOf('class="pizza-only-touch'), page.indexOf('class="pizza-only-pointer'));
      const pc = page.slice(page.indexOf('class="pizza-only-pointer'));
      expect(phone).toContain("Take a photo of the receipt");
      expect(phone).toContain('capture="environment"');
      expect(phone).toContain("Use a saved photo");
      expect(pc).toContain("Attach the receipt image");
      expect(pc).not.toContain("capture=");
      expect(pc).toContain("or drop it here");
      expect(page).toContain("Read the receipt");
      const css = await w.app.inject({ url: "/static/money.css", headers: { host: "demo.test" } });
      expect(css.body).toContain("@media (any-pointer: fine)");
    });

    it("keeps a saved photo sent beside an empty camera field, as a browser posts it", async () => {
      const r = await upload(w, "pena", `/hold/${id}/money/scan`, [
        { name: "", type: "application/octet-stream", bytes: Buffer.alloc(0) },
        { name: "receipt.png", type: "image/png", bytes: await png() },
      ]);
      expect(location(r)).toBe(`/pizza/hold/${id}/money/total`);
      expect(((await money()).receipts as unknown[]).length).toBe(1);
    });

    it("shows the confirmed receipt's photo, which the holder's browser can load (mockup 18 E)", async () => {
      await upload(w, "pena", `/hold/${id}/money/scan`, [
        { name: "receipt.png", type: "image/png", bytes: await png() },
      ]);
      await form(w, "pena", `/hold/${id}/money/total`, { total: "39.00" });
      const page = (await view(w, "pena", `/hold/${id}/money`)).body;
      const img = page.match(/<img[^>]*src="([^"]+)"[^>]*>/);
      expect(img).not.toBeNull();
      // The thumbnail is at the top of the page: lazy loading left it blank in a full-page shot.
      expect(img?.[0]).not.toContain('loading="lazy"');
      const photo = await view(w, "pena", img?.[1] ?? "");
      expect(photo.statusCode).toBe(200);
      expect(photo.headers["content-type"]).toMatch(/^image\//);
    });

    it("shows a refused Confirm on the check page, with the read still there", async () => {
      await turnOnReader();
      const r = await upload(w, "pena", `/hold/${id}/money/scan`, [
        { name: "receipt.png", type: "image/png", bytes: await png() },
      ]);
      const receipt = new URL(location(r), "http://x").searchParams.get("receipt") ?? "";
      const done = await form(w, "pena", `/hold/${id}/money/check`, {
        receipt_id: "pr_not_this_orders",
        total: "39.00",
      });
      expect(location(done)).toMatch(
        new RegExp(`^/pizza/hold/${id}/money/check\\?receipt=pr_not_this_orders&error=`),
      );
      // The error shows on the check page of the real receipt, whose read is not lost.
      const page = (
        await view(w, "pena", `/hold/${id}/money/check?receipt=${receipt}&error=Nope%20not%20that`)
      ).body;
      expect(page).toContain("Nope not that");
      expect(page).toContain("Check the read");
    });

    it("keeps the photo and asks for the total when the reader is off", async () => {
      const r = await upload(w, "pena", `/hold/${id}/money/scan`, [
        { name: "receipt.png", type: "image/png", bytes: await png() },
      ]);
      expect(location(r)).toBe(`/pizza/hold/${id}/money/total`);
      expect(((await money()).receipts as unknown[]).length).toBe(1);
      expect(w.reader.sent).toEqual([]);
    });

    it("says the reader failed, and that typing still works", async () => {
      await turnOnReader();
      w.reader.fail = "failed";
      const r = await upload(w, "pena", `/hold/${id}/money/scan`, [
        { name: "receipt.png", type: "image/png", bytes: await png() },
      ]);
      expect(location(r)).toContain(`/pizza/hold/${id}/money/total?error=`);
    });
  },
);

describe.skipIf(!DATABASE_URL)("the hand-out with money, and My order (mockups 09, 05)", () => {
  beforeEach(async () => {
    await w.call("pena", "POST", `/api/pizza/orders/${id}/arrive`, { pickup: "Entrance table" });
    await w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, { total_cents: 4000 });
  });

  it("shows each person's amount, and the Paid column only when it settles to the holder", async () => {
    let page = (await view(w, "pena", `/hold/${id}/hand-out`)).body;
    expect(page).toContain("€21.00");
    expect(page).toContain("Settled through the organiser");
    expect(page).not.toContain("Paid you");
    await w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, { settle_to: "payer" });
    await form(w, "pena", `/hold/${id}/paid`, { user_id: "u_anni", paid: "yes" });
    page = (await view(w, "pena", `/hold/${id}/hand-out`)).body;
    expect(page).toContain("Paid you");
    expect(page).toContain("1 paid you");
    expect(page).toContain("you paid");
  });

  it("gives each person their own amount, and how to pay the holder", async () => {
    await w.call("pena", "PUT", "/api/pizza/me/pay-details", {
      mobilepay: "040 000 0000",
      iban: null,
    });
    let page = (await view(w, "anni", `/orders/${id}`)).body;
    expect(page).toContain("Your share");
    expect(page).toContain("€21.00");
    expect(page).toContain("You pay the organiser after the event.");
    await w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, { settle_to: "payer" });
    page = (await view(w, "anni", `/orders/${id}`)).body;
    expect(page).toContain("Pay Pena €21.00");
    // A6: the amount shows once, in the sentence that says whom to pay.
    expect(page.match(/€21\.00/g) ?? []).toHaveLength(1);
    expect(page).toContain("040 000 0000");
    expect(page).toContain("data-copy=");
    expect(page).not.toContain("Mikko");
    await w.call("pena", "PUT", `/api/pizza/orders/${id}/paid/u_anni`, { paid: true });
    expect((await view(w, "anni", `/orders/${id}`)).body).toContain("Pena has your payment marked");
  });

  it("shows the money after Everyone got theirs (mockup 09 C)", async () => {
    await w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, { settle_to: "payer" });
    await w.call("pena", "PUT", `/api/pizza/orders/${id}/paid/u_anni`, { paid: true });
    await w.call("pena", "POST", `/api/pizza/orders/${id}/hand-out`, {});
    const page = (await view(w, "pena", `/hold/${id}/hand-out`)).body;
    expect(page).toContain("You paid Demo Pizzeria €40.00");
    expect(page).toContain("Paid you: Anni");
    expect(page).toContain("Still owes you");
    expect(page).toContain("The order&#39;s money");
  });
});
