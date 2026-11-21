/** The split of a receipt line over its pizzas, and the photo sent to the provider. */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PROVIDER_MAX_BYTES, forProvider } from "../src/photos.js";
import { matchReceipt } from "../src/receipt-match.js";

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
