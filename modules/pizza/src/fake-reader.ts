/**
 * A reader that calls no provider: the tests and the CI stack (`CANCCU_PIZZA_READER=fake`, dev
 * only) read with it. It answers the receipt and the menu of mockups 18 and 11 D, and keeps what
 * it was sent, so a test sees that only a shrunk photo left the module.
 */
import sharp from "sharp";
import type { MenuReading, Reader, ReceiptReading } from "./reader.js";
import { ReaderFailed, ReaderKeyRejected } from "./reader.js";

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
}

export class FakeReader {
  receipt: ReceiptReading = DEMO_RECEIPT;
  menu: MenuReading[] = DEMO_MENU;
  fail: "failed" | "rejected" | null = null;
  readonly sent: Sent[] = [];
  /** A test holds the provider's answer back until this settles (a slow provider). */
  hold: Promise<void> | null = null;

  /** A `ReaderFor`: each key gets a reader that answers this fake's current script. */
  for = (key: string): Reader => ({
    receipt: async (image, type) => {
      await this.note("receipt", key, image, type);
      await this.hold;
      return this.receipt;
    },
    menu: async (image, type) => {
      await this.note("menu", key, image, type);
      return this.menu;
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
    });
    if (this.fail === "failed") throw new ReaderFailed();
    if (this.fail === "rejected") throw new ReaderKeyRejected();
  }
}
