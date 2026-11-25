/** The split of a receipt line over its pizzas, and the photo sent to the provider. */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PROVIDER_MAX_BYTES, forProvider } from "../src/photos.js";
import { matchReceipt } from "../src/receipt-match.js";
import type { ReceiptLine } from "../src/reader.js";

describe("a receipt line over its pizzas", () => {
  it("gives the remainder cents to the first pizzas, so 2 × 25.01 adds up", () => {
    const item = (id: string) => ({
      id,
      user_id: id,
      name: id,
      label: "#1 Margherita",
      number: "1",
      price_cents: 2500,
    });
    const m = matchReceipt(
      {
        total_cents: 5002,
        lines: [
          {
            text: "2 x 1 Margherita 50.02",
            number: "1",
            name: "Margherita",
            quantity: 2,
            amount_cents: 5002,
            kind: "item",
          },
        ],
      },
      [item("a"), item("b")],
      new Date(0),
    );
    expect(m.pizzas.map((p) => p.suggested_cents)).toEqual([2501, 2501]);
    const three = matchReceipt(
      {
        total_cents: 1000,
        lines: [
          {
            text: "3 x 1 Margherita 10.00",
            number: "1",
            name: "Margherita",
            quantity: 3,
            amount_cents: 1000,
            kind: "item",
          },
        ],
      },
      [item("a"), item("b"), item("c")],
      new Date(0),
    );
    expect(three.pizzas.map((p) => p.suggested_cents)).toEqual([334, 333, 333]);
    expect(three.adds_up).toBe(true);
  });
});

describe("the photo sent to the provider", () => {
  it("is a JPEG within the limit, even for a large PNG", async () => {
    const noise = Buffer.alloc(2400 * 2400 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    const big = await sharp(noise, { raw: { width: 2400, height: 2400, channels: 3 } })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const sent = await forProvider(big, "image/png");
    expect(sent.type).toBe("image/jpeg");
    expect(sent.image.length).toBeLessThanOrEqual(PROVIDER_MAX_BYTES);
    expect((await sharp(sent.image).metadata()).format).toBe("jpeg");
  });
  it("keeps a JPEG that already fits", async () => {
    const jpeg = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#fff" } })
      .jpeg()
      .toBuffer();
    expect((await forProvider(jpeg, "image/jpeg")).image).toBe(jpeg);
  });
});

describe("a group line: '15 × pizza €195' (#789 item 9, D18)", () => {
  const pizza = (i: number, price_cents: number | null = 1300, number: string | null = "1") => ({
    id: `pi_${String(i)}`,
    user_id: `u_${String(i)}`,
    name: `P${String(i)}`,
    label: number === null ? "Other: something" : `#${number} Demo ${number}`,
    number,
    price_cents,
  });
  const line = (
    o: Partial<ReceiptLine> & Pick<ReceiptLine, "text" | "amount_cents">,
  ): ReceiptLine => ({
    number: null,
    name: "pizza",
    quantity: 1,
    kind: "item",
    ...o,
  });
  const fifteen = (o: Partial<ReceiptLine> = {}) =>
    line({ text: "15 x pizza 195.00", quantity: 15, amount_cents: 19500, group: true, ...o });
  const pizzas = (n: number, price = (i: number) => 1200 + (i % 3) * 100) =>
    Array.from({ length: n }, (_, i) => pizza(i, price(i)));

  it("covers the unnamed pizzas and keeps their menu prices; the difference is shared as extras", () => {
    const items = pizzas(15);
    const prices = items.reduce((s, p) => s + (p.price_cents ?? 0), 0);
    const m = matchReceipt({ total_cents: 19500, lines: [fifteen()] }, items, new Date(0));
    expect(m.pizzas.every((p) => p.group && p.line === 0)).toBe(true);
    expect(m.pizzas.map((p) => p.suggested_cents)).toEqual(items.map((p) => p.price_cents));
    expect(m.pizzas.some((p) => p.differs)).toBe(false);
    expect(m.extras_cents).toBe(19500 - prices);
    expect(m.adds_up).toBe(true);
    expect(m.unmatched_lines).toEqual([]);
    expect(m.group_count_mismatch).toEqual([]);
  });
  it("'à €13,00' sets each pizza's price to 1300", () => {
    const m = matchReceipt(
      { total_cents: 19500, lines: [fifteen({ unit_cents: 1300 })] },
      pizzas(15),
      new Date(0),
    );
    expect(m.pizzas.every((p) => p.suggested_cents === 1300)).toBe(true);
    expect(m.extras_cents).toBe(0);
    expect(m.adds_up).toBe(true);
  });
  it("warns when the group's count is unlike the order's pizzas", () => {
    const fewer = matchReceipt({ total_cents: 19500, lines: [fifteen()] }, pizzas(14), new Date(0));
    expect(fewer.group_count_mismatch).toEqual([{ line: 0, count: 15, pizzas: 14 }]);
    const more = matchReceipt({ total_cents: 19500, lines: [fifteen()] }, pizzas(16), new Date(0));
    expect(more.group_count_mismatch).toEqual([{ line: 0, count: 15, pizzas: 16 }]);
    // The sixteenth is named by no line.
    expect(more.pizzas.filter((p) => p.line === null)).toHaveLength(1);
  });
  it("reads Finnish group lines the model did not mark", () => {
    for (const [text, name, unit] of [
      ["15 × pizza 195,00 €", "pizza", null],
      ["15 kpl pizza €195", "pizza", null],
      ["15 kpl pizzaa à 13,00 €", "pizzaa", 1300],
      ["15 x Pizza a 13,00", "Pizza", 1300],
      ["15 × pizzat á €13.00", "pizzat", 1300],
    ] as const) {
      const m = matchReceipt(
        { total_cents: 19500, lines: [line({ text, name, quantity: 15, amount_cents: 19500 })] },
        pizzas(15),
        new Date(0),
      );
      expect(
        m.pizzas.every((p) => p.group),
        text,
      ).toBe(true);
      if (unit !== null)
        expect(
          m.pizzas.every((p) => p.suggested_cents === unit),
          text,
        ).toBe(true);
      else
        expect(
          m.pizzas.map((p) => p.suggested_cents),
          text,
        ).toEqual(pizzas(15).map((p) => p.price_cents));
    }
  });
  it("matches named lines before the group line", () => {
    const items = [...pizzas(3), pizza(9, 950, "12")];
    const m = matchReceipt(
      {
        total_cents: 4900,
        lines: [
          line({ text: "3 x pizza 39.00", quantity: 3, amount_cents: 3900, group: true }),
          line({ text: "12 Kebab 10.00", number: "12", name: "Kebab", amount_cents: 1000 }),
        ],
      },
      items,
      new Date(0),
    );
    expect(m.pizzas.find((p) => p.item_id === "pi_9")).toMatchObject({
      line: 1,
      suggested_cents: 1000,
      group: false,
    });
    expect(m.pizzas.filter((p) => p.group).map((p) => p.line)).toEqual([0, 0, 0]);
    expect(m.adds_up).toBe(true);
  });
  it("splits the line evenly when a pizza it covers has no price and no unit price is shown", () => {
    const items = [pizza(0, null), pizza(1, 1200), pizza(2, 1300)];
    const m = matchReceipt(
      {
        total_cents: 3900,
        lines: [line({ text: "3 x pizza 39.00", quantity: 3, amount_cents: 3900, group: true })],
      },
      items,
      new Date(0),
    );
    expect(m.pizzas.map((p) => p.suggested_cents)).toEqual([1300, 1300, 1300]);
    expect(m.adds_up).toBe(true);
  });
  it("a line naming a real pizza is not a group", () => {
    const m = matchReceipt(
      {
        total_cents: 1300,
        lines: [
          line({ text: "Pizza Margherita 13.00", name: "Pizza Margherita", amount_cents: 1300 }),
        ],
      },
      [pizza(0, 1300)],
      new Date(0),
    );
    expect(m.pizzas[0]?.group).toBe(false);
    expect(m.unmatched_lines).toEqual([0]);
  });
});
