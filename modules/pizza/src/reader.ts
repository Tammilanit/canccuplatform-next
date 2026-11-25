/**
 * The optional AI reader (the step 5 plan, The optional AI reader): a photo in, data a person then
 * confirms out. One small interface, so another vision model can replace the provider; CI uses
 * `FakeReader` and never calls one.
 */
import { KitError } from "@canccu/kit";
import type { ErrorBody } from "@canccu/kit";

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
  /**
   * The photo did not make the line clear: the check page marks it (a partly read receipt).
   * Reads kept before #789 have none.
   */
  unsure?: boolean;
  /** The line names no item ("15 × pizza"): it covers the pizzas no other line names (#789 item 9). */
  group?: boolean;
  /** The unit price the line shows ("à €13,00"), or null. */
  unit_cents?: number | null;
}

export interface ReceiptReading {
  total_cents: number | null;
  lines: ReceiptLine[];
}

/**
 * One row of a menu as read (#789 items 3–6, 15): an item, the own pizza's base or a topping, with
 * the page it was on and its category. A heading's price (`category_price_cents`) is given to its
 * items without one after the read (`applyCategories`); `unsure` marks what the photo left unclear.
 */
export interface MenuRow {
  page: number;
  kind: "item" | "base" | "topping";
  number: string | null;
  name: string;
  description: string | null;
  price_cents: number | null;
  category: string | null;
  category_price_cents: number | null;
  /** The base only: how many toppings its price includes ("choose 3 toppings"). */
  included_toppings: number | null;
  /** The base only: the price of each topping past the included ones. */
  extra_topping_cents: number | null;
  /** A topping only: `special` ones cost extra even within the included count. */
  tier: "normal" | "special" | null;
  unsure: boolean;
  /** The price is the category's, not the item's own. */
  price_from_category?: boolean;
  /** Gathered from the pizzas' ingredients, for the crew to confirm (`gatherToppings`). */
  gathered?: boolean;
}

/** A dated campaign or a lunch price: shown above the table, never a price (#789 item 5). */
export interface MenuNote {
  kind: "campaign" | "lunch";
  text: string;
  page: number;
}

/** A menu read of one or more pages, as one menu. */
export interface MenuRead {
  rows: MenuRow[];
  notes: MenuNote[];
}

/** What one read used: the read log's tokens and so its cost (#789 item 12). */
export interface ReadUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface Page {
  image: Buffer;
  type: string;
}

/** At most this many pages go to the reader in one menu read (#789 item 15). */
export const MAX_PAGES = 6;

/** About what one menu page costs to read, for the estimate shown before the read (#789 item 15). */
export const PAGE_COST_MICRO_USD = 1500;

export interface Reader {
  receipt(image: Buffer, type: string): Promise<{ reading: ReceiptReading; usage: ReadUsage }>;
  /** Every page in one call, in order, so a category running on keeps its price (#789 item 15). */
  menu(pages: Page[]): Promise<{ reading: MenuRead; usage: ReadUsage }>;
}

/**
 * How long the provider may take: 50 s for one page and 10 s for each further one, at most 100 s
 * (#789 D4); the pages give up a little after it.
 */
export const timeoutFor = (pages: number): number =>
  Math.min(100_000, 50_000 + 10_000 * (Math.max(1, pages) - 1));

/** A reader for the event's provider key. */
export type ReaderFor = (apiKey: string) => Reader;

export const PROVIDER = { id: "anthropic", name: "Anthropic", model: "Claude Haiku 5.5" } as const;

/**
 * The model's prices in micro-dollars per token: Claude Haiku 5.5 at $0.10 per million tokens in
 * and $0.50 out (prompts under 100K tokens, which a few photos are). Change with the model.
 */
const MICRO_USD_PER_TOKEN = { input: 0.1, output: 0.5 } as const;

/** What a read cost, rounded up so a paid read never shows as free. */
export const costMicroUsd = (u: ReadUsage): number =>
  Math.ceil(
    u.input_tokens * MICRO_USD_PER_TOKEN.input + u.output_tokens * MICRO_USD_PER_TOKEN.output,
  );

/**
 * Why a read gave nothing (#789 item 11): each has its own words and way forward on the pages.
 * `unreadable` and `declined` are the model's answers; the rest are the provider's or the network's.
 */
export type ReadReason =
  | "timeout"
  | "service_down"
  | "rate_limited"
  | "out_of_credit"
  | "declined"
  | "unreadable"
  | "failed";

const MESSAGES: Record<ReadReason, string> = {
  timeout: "The reader took too long. Try again, or type the numbers instead.",
  service_down: "The reader's service is down. Try again, or type the numbers instead.",
  rate_limited: "The reader is busy. It tries again shortly.",
  out_of_credit:
    "The reader's account is out of credit or over its limit. Type the numbers instead.",
  declined: "The reader would not read this photo. Type the numbers instead.",
  unreadable: "The reader could not read this photo. Take it again, or type the numbers instead.",
  failed: "The reader did not answer. Type the numbers instead.",
};

/**
 * The read gave nothing: 502 `reader_failed` as before, its body naming the `reason` (and, when
 * rate limited, `retry_after_s`), so a client that only knows the code keeps working (D1).
 */
export class ReaderFailed extends KitError {
  readonly reason: ReadReason;
  readonly retryAfterS: number | null;
  /** What the model used before it gave nothing; null when the provider never answered. */
  readonly usage: ReadUsage | null;

  constructor(
    reason: ReadReason = "failed",
    o: { message?: string; retryAfterS?: number; usage?: ReadUsage } = {},
  ) {
    super(o.message ?? MESSAGES[reason], { status: 502, code: "reader_failed" });
    this.reason = reason;
    this.retryAfterS = o.retryAfterS ?? null;
    this.usage = o.usage ?? null;
  }

  override toBody(): ErrorBody {
    const error = { ...super.toBody().error, reason: this.reason };
    return {
      error: this.retryAfterS === null ? error : { ...error, retry_after_s: this.retryAfterS },
    } as ErrorBody;
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
