/**
 * A reader that calls no provider: the tests and the CI stack (`CANCCU_PIZZA_READER=fake`, dev
 * only) read with it. It answers the receipt and the menu of mockups 18 and 11 D, and keeps what
 * it was sent, so a test sees that only a shrunk photo left the module.
 */
import sharp from "sharp";
import type { MenuReading, ReadReason, ReadUsage, Reader, ReceiptReading } from "./reader.js";
import { ReaderFailed, ReaderKeyRejected } from "./reader.js";

/** What a fake read "used": about a phone photo's tokens, so the read log has a cost to show. */
export const FAKE_USAGE: ReadUsage = { input_tokens: 1600, output_tokens: 400 };

/** The reasons the model itself gives: it answered, so the read used tokens. */
const ANSWERED: ReadonlySet<ReadReason> = new Set(["unreadable", "declined"]);

export const DEMO_RECEIPT: ReceiptReading = {
  total_cents: 5450,
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
      text: "3 x 4 Margherita 24.00",
      number: "4",
      name: "Margherita",
      quantity: 3,
      amount_cents: 2400,
      kind: "item",
    },
    {
      text: "1 x 7 Funghi 8.50",
      number: "7",
      name: "Funghi",
      quantity: 1,
      amount_cents: 850,
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
      text: "Discount -1.00",
      number: null,
      name: "Discount",
      quantity: 1,
      amount_cents: -100,
      kind: "extra",
    },
  ],
};

export const DEMO_MENU: MenuReading[] = [
  {
    number: "4",
    name: "Margherita",
    description: "tomato, mozzarella",
    price_cents: 800,
    unsure: false,
  },
  {
    number: "7",
    name: "Funghi",
    description: "mushroom, mozzarella",
    price_cents: 850,
    unsure: false,
  },
  {
    number: "12",
    name: "Kebab",
    description: "kebab, onion, chili",
    price_cents: 950,
    unsure: true,
  },
];

export interface Sent {
  kind: "receipt" | "menu";
  key: string;
  type: string;
  width: number;
  height: number;
  /** Whether the bytes still carried EXIF (a location among it). */
  exif: boolean;
  bytes: Buffer;
}

export class FakeReader {
  receipt: ReceiptReading = DEMO_RECEIPT;
  menu: MenuReading[] = DEMO_MENU;
  fail: ReadReason | "rejected" | null = null;
  /** The wait a `rate_limited` failure names. */
  retryAfterS = 5;
  /** The words of an `unreadable` failure, as the model would give them. */
  unreadableReason = "The photo is blurred: hold the phone still and take it again.";
  readonly sent: Sent[] = [];
  /** A test holds the provider's answer back until this settles (a slow provider). */
  hold: Promise<void> | null = null;

  /** A `ReaderFor`: each key gets a reader that answers this fake's current script. */
  for = (key: string): Reader => ({
    receipt: async (image, type) => {
      await this.note("receipt", key, image, type);
      return { reading: this.receipt, usage: FAKE_USAGE };
    },
    menu: async (pages) => {
      for (const p of pages) await this.note("menu", key, p.image, p.type);
      return { reading: { items: this.menu }, usage: FAKE_USAGE };
    },
  });

  private async note(kind: Sent["kind"], key: string, image: Buffer, type: string): Promise<void> {
    const m = await sharp(image).metadata();
    this.sent.push({
      kind,
      key,
      type,
      width: m.width,
      height: m.height,
      exif: m.exif !== undefined,
      bytes: image,
    });
    await this.hold;
    const fail = this.fail;
    if (fail === null) return;
    if (fail === "rejected") throw new ReaderKeyRejected();
    throw new ReaderFailed(fail, {
      ...(fail === "rate_limited" ? { retryAfterS: this.retryAfterS } : {}),
      ...(fail === "unreadable" ? { message: this.unreadableReason } : {}),
      ...(ANSWERED.has(fail) ? { usage: FAKE_USAGE } : {}),
    });
  }
}
