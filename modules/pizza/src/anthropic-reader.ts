/**
 * The AI reader on Anthropic's Claude Haiku 5.5 (the plan, The optional AI reader: the model and
 * its cost were chosen there). One request per read, a menu's pages together: the photos and fixed
 * instructions (`reader-schemas.ts`), never a name or an order's data, with a structured answer.
 * `timeoutFor(pages)` and no retries, so a slow or failing provider never holds a page; a refused
 * key is reported once, never tried in a loop. Each way a read can fail is named (#789 item 11).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Page, Reader, ReadUsage } from "./reader.js";
import { ReaderFailed, ReaderKeyRejected, timeoutFor } from "./reader.js";
import {
  MENU_SCHEMA,
  MENU_TEXT,
  RECEIPT_SCHEMA,
  RECEIPT_TEXT,
  menuOf,
  receiptOf,
  unreadable,
} from "./reader-schemas.js";

export const MODEL = "claude-haiku-5-5";

/** The out-of-credit answers: a used-up balance (400, or 402) and the account's spend limit (429). */
const NO_CREDIT = /credit balance|usage limit|spend limit/i;

/** The provider's error as the reader's own: why, and for a rate limit how long to wait. */
function failureOf(err: unknown): Error {
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  )
    return new ReaderKeyRejected();
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ReaderFailed("timeout");
  if (err instanceof Anthropic.APIConnectionError) return new ReaderFailed("service_down");
  if (err instanceof Anthropic.APIError) {
    const message = typeof err.apiMessage === "string" ? err.apiMessage : "";
    if (err.status === 402 || err.type === "billing_error" || NO_CREDIT.test(message))
      return new ReaderFailed("out_of_credit");
    if (err.status === 429) {
      const headers = err.headers as Headers | undefined;
      const after = Number(headers?.get("retry-after") ?? "");
      // A wait the provider did not name, or one past a page's patience, is a short default.
      const retryAfterS = Number.isInteger(after) && after > 0 && after <= 120 ? after : 10;
      return new ReaderFailed("rate_limited", { retryAfterS });
    }
    if (typeof err.status === "number" && err.status >= 500)
      return new ReaderFailed("service_down");
  }
  return new ReaderFailed("failed");
}

/** `fetch` is for the tests, which never reach the provider. */
export function anthropicReader(apiKey: string, o: { fetch?: typeof fetch } = {}): Reader {
  const client = new Anthropic({
    apiKey,
    maxRetries: 0,
    ...(o.fetch === undefined ? {} : { fetch: o.fetch }),
  });
  const ask = async (
    pages: Page[],
    text: string,
    schema: object,
  ): Promise<{ raw: unknown; usage: ReadUsage }> => {
    const started = Date.now();
    let res: Anthropic.Message;
    try {
      res = await client.messages.create(
        {
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
                ...pages.map((p) => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: p.type as "image/jpeg" | "image/png" | "image/webp",
                    data: p.image.toString("base64"),
                  },
                })),
                { type: "text", text },
              ],
            },
          ],
        },
        { timeout: timeoutFor(pages.length) },
      );
    } catch (err) {
      throw failureOf(err);
    }
    const usage = {
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      ms: Date.now() - started,
    };
    if (res.stop_reason === "refusal") throw new ReaderFailed("declined", { usage });
    // A cut-off answer is no reading: the holder types instead.
    if (res.stop_reason !== "end_turn") throw new ReaderFailed("failed", { usage });
    const block = res.content.find((b) => b.type === "text");
    let raw: unknown;
    try {
      raw = JSON.parse(block?.type === "text" ? block.text : "");
    } catch {
      throw new ReaderFailed("failed", { usage });
    }
    const why = unreadable(raw);
    if (why !== null) throw new ReaderFailed("unreadable", { message: why, usage });
    return { raw, usage };
  };
  return {
    receipt: async (image, type) => {
      const { raw, usage } = await ask([{ image, type }], RECEIPT_TEXT, RECEIPT_SCHEMA);
      return { reading: receiptOf(raw), usage };
    },
    menu: async (pages) => {
      const { raw, usage } = await ask(pages, MENU_TEXT, MENU_SCHEMA);
      return { reading: menuOf(raw), usage };
    },
  };
}
