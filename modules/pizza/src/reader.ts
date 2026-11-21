/**
 * The optional AI reader (the step 5 plan, The optional AI reader): a photo in, data a person then
 * confirms out. One small interface, so another vision model can replace the provider; CI uses
 * `FakeReader` and never calls one.
 */
import { KitError } from "@canccu/kit";

/** One line of a receipt as read: a menu item or an extra (a delivery fee, a discount). */
export interface ReceiptLine {
  text: string;
  /** The menu number when the line shows one. */
  number: string | null;
  name: string;
  quantity: number;
  /** The line's amount; negative for a discount. */
  amount_cents: number;
  kind: "item" | "extra";
}

export interface ReceiptReading {
  total_cents: number | null;
  lines: ReceiptLine[];
}

/** One menu item as read; `unsure` when the photo did not settle its price or number. */
export interface MenuReading {
  number: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  unsure: boolean;
}

export interface Reader {
  receipt(image: Buffer, type: string): Promise<ReceiptReading>;
  menu(image: Buffer, type: string): Promise<MenuReading[]>;
}

/** A reader for the event's provider key. */
export type ReaderFor = (apiKey: string) => Reader;

export const PROVIDER = { id: "anthropic", name: "Anthropic", model: "Claude Haiku 5.5" } as const;

/** The provider failed or took too long: the page says so and typing still works. */
export class ReaderFailed extends KitError {
  constructor(message = "The reader did not answer. Type the numbers instead.") {
    super(message, { status: 502, code: "reader_failed" });
  }
}

/** The provider refused the key: the reader stops until an admin sets a key again. */
export class ReaderKeyRejected extends KitError {
  constructor() {
    super("The reader's API key was refused. An admin sets a new one in Integrations.", {
      status: 502,
      code: "reader_key_rejected",
    });
  }
}
