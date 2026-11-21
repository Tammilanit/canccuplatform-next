/**
 * The AI reader on Anthropic's Claude Haiku 5.5 (the plan, The optional AI reader: the model and
 * its cost were chosen there). One request per photo: the photo and fixed instructions, never a
 * name or an order's data, with a structured answer. 20 s at most and no retries, so a slow or
 * failing provider never holds a page; a refused key is reported once, never tried in a loop.
 * The answer is checked here as any outside input: numbers bounded, texts cut to size.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { MenuReading, Reader, ReceiptLine, ReceiptReading } from "./reader.js";
import { ReaderFailed, ReaderKeyRejected } from "./reader.js";

const MODEL = "claude-haiku-5-5";
const TIMEOUT_MS = 20_000;

const nullable = (type: "integer" | "string") => ({ anyOf: [{ type }, { type: "null" }] });

const RECEIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["total_cents", "lines"],
  properties: {
    total_cents: nullable("integer"),
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "number", "name", "quantity", "amount_cents", "kind"],
        properties: {
          text: { type: "string" },
          number: nullable("string"),
          name: { type: "string" },
          quantity: { type: "integer" },
          amount_cents: { type: "integer" },
          kind: { type: "string", enum: ["item", "extra"] },
        },
      },
    },
  },
};

const MENU_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "name", "description", "price_cents", "unsure"],
        properties: {
          number: { type: "string" },
          name: { type: "string" },
          description: nullable("string"),
          price_cents: nullable("integer"),
          unsure: { type: "boolean" },
        },
      },
    },
  },
};

const RECEIPT_TEXT = `This is a photo of a receipt from a pizzeria or a restaurant.
Read every line that was paid for. For each line give its text as printed, the menu number when the line shows one (else null), the item's name, the quantity, the line's amount in euro cents (a discount is negative), and kind: "item" for food or drink, "extra" for a delivery fee, a service fee or a discount.
Give total_cents, the total paid in euro cents, or null when the photo does not show it.
Use only what the photo shows. Leave out card numbers, names and anything that is not a paid line.`;

const MENU_TEXT = `This is a photo of a page of a pizzeria's or a restaurant's menu.
List every item that has a menu number: the number as printed, the name, the ingredients or description (null when none), and the price in euro cents (null when none is shown).
Set unsure to true when the photo does not make the number, the name or the price clear.
Use only what the photo shows.`;

const cut = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const cents = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

function receiptOf(raw: unknown): ReceiptReading {
  const r = (raw ?? {}) as { total_cents?: unknown; lines?: unknown };
  const lines: ReceiptLine[] = (Array.isArray(r.lines) ? r.lines : [])
    .slice(0, 100)
    .flatMap((l) => {
      const x = (l ?? {}) as Record<string, unknown>;
      const amount = cents(x.amount_cents, -500_000, 500_000);
      if (amount === null) return [];
      const number = cut(x.number, 8);
      return [
        {
          text: cut(x.text, 120),
          number: number === "" ? null : number,
          name: cut(x.name, 80),
          quantity: cents(x.quantity, 1, 99) ?? 1,
          amount_cents: amount,
          kind: x.kind === "extra" ? ("extra" as const) : ("item" as const),
        },
      ];
    });
  return { total_cents: cents(r.total_cents, 0, 500_000), lines };
}

function menuOf(raw: unknown): MenuReading[] {
  const items = ((raw ?? {}) as { items?: unknown }).items;
  return (Array.isArray(items) ? items : []).slice(0, 300).flatMap((i) => {
    const x = (i ?? {}) as Record<string, unknown>;
    const number = cut(x.number, 8);
    const name = cut(x.name, 80);
    if (number === "" || name === "") return [];
    const description = cut(x.description, 300);
    return [
      {
        number,
        name,
        description: description === "" ? null : description,
        price_cents: cents(x.price_cents, 0, 99_999),
        unsure: x.unsure === true,
      },
    ];
  });
}

/** `fetch` is for the tests, which never reach the provider. */
export function anthropicReader(apiKey: string, o: { fetch?: typeof fetch } = {}): Reader {
  const client = new Anthropic({
    apiKey,
    timeout: TIMEOUT_MS,
    maxRetries: 0,
    ...(o.fetch === undefined ? {} : { fetch: o.fetch }),
  });
  const ask = async (
    image: Buffer,
    type: string,
    text: string,
    schema: object,
  ): Promise<unknown> => {
    let res: Anthropic.Message;
    try {
      res = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: schema as Record<string, unknown> },
        },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: type as "image/jpeg" | "image/png" | "image/webp",
                  data: image.toString("base64"),
                },
              },
              { type: "text", text },
            ],
          },
        ],
      });
    } catch (err) {
      if (
        err instanceof Anthropic.AuthenticationError ||
        err instanceof Anthropic.PermissionDeniedError
      )
        throw new ReaderKeyRejected();
      throw new ReaderFailed();
    }
    // A refusal or a cut-off answer is no reading: the holder types instead.
    if (res.stop_reason !== "end_turn") throw new ReaderFailed();
    const block = res.content.find((b) => b.type === "text");
    try {
      return JSON.parse(block?.type === "text" ? block.text : "");
    } catch {
      throw new ReaderFailed();
    }
  };
  return {
    receipt: async (image, type) => receiptOf(await ask(image, type, RECEIPT_TEXT, RECEIPT_SCHEMA)),
    menu: async (image, type) => menuOf(await ask(image, type, MENU_TEXT, MENU_SCHEMA)),
  };
}
