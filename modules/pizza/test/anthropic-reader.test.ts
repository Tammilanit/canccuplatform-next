/**
 * The Anthropic reader against a fake `fetch` (the plan: no test calls the provider): the request
 * holds the photo and fixed instructions only, the answer is checked as outside input, and a
 * refused key, a refusal and a failure each end as the reader's own error.
 */
import { describe, expect, it } from "vitest";
import { anthropicReader } from "../src/anthropic-reader.js";
import { ReaderFailed, ReaderKeyRejected } from "../src/reader.js";

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(answer: { status?: number; body: unknown }, sent: Sent[]): typeof fetch {
  return (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    sent.push({
      url: url instanceof Request ? url.url : url.toString(),
      headers,
      body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
        string,
        unknown
      >,
    });
    return Promise.resolve(Response.json(answer.body, { status: answer.status ?? 200 }));
  };
}

const message = (text: string, stop = "end_turn") => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-haiku-5-5",
  content: [{ type: "text", text }],
  stop_reason: stop,
  stop_details: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});

const PHOTO = Buffer.from("photo-bytes");

describe("the Anthropic reader", () => {
  it("sends the photo and fixed instructions to Claude Haiku 5.5, with the key, and nothing else", async () => {
    const sent: Sent[] = [];
    const answer = { total_cents: 1200, lines: [] };
    const r = anthropicReader("sk-ant-test", {
      fetch: fakeFetch({ body: message(JSON.stringify(answer)) }, sent),
    });
    await r.receipt(PHOTO, "image/jpeg");
    const req = sent[0] as Sent;
    expect(req.url).toContain("/v1/messages");
    expect(req.headers.authorization).toBe("Bearer sk-ant-test");
    expect(req.body).toMatchObject({ model: "claude-haiku-5-5" });
    const content = (
      req.body.messages as { content: { type: string; source?: { data: string } }[] }[]
    )[0]?.content;
    expect(content?.map((c) => c.type)).toEqual(["image", "text"]);
    expect(content?.[0]?.source?.data).toBe(PHOTO.toString("base64"));
    expect(req.body.output_config).toMatchObject({ format: { type: "json_schema" } });
  });

  it("checks the answer as outside input: bounds, sizes, kinds", async () => {
    const answer = {
      total_cents: -5,
      lines: [
        {
          text: "x".repeat(500),
          number: "12",
          name: "Kebab",
          quantity: 2,
          amount_cents: 1900,
          kind: "item",
        },
        {
          text: "Discount",
          number: null,
          name: "Discount",
          quantity: 0,
          amount_cents: -100,
          kind: "weird",
        },
        {
          text: "Broken",
          number: null,
          name: "Broken",
          quantity: 1,
          amount_cents: 1.5,
          kind: "item",
        },
      ],
    };
    const r = anthropicReader("k", {
      fetch: fakeFetch({ body: message(JSON.stringify(answer)) }, []),
    });
    const read = await r.receipt(PHOTO, "image/png");
    expect(read.total_cents).toBeNull();
    expect(read.lines).toHaveLength(2);
    expect(read.lines[0]?.text).toHaveLength(120);
    expect(read.lines[1]).toMatchObject({ quantity: 1, kind: "item", amount_cents: -100 });
  });

  it("reads a menu page into items, leaving out those without a number", async () => {
    const answer = {
      items: [
        { number: "4", name: "Margherita", description: "tomato", price_cents: 800, unsure: false },
        { number: "", name: "Drinks", description: null, price_cents: null, unsure: false },
      ],
    };
    const r = anthropicReader("k", {
      fetch: fakeFetch({ body: message(JSON.stringify(answer)) }, []),
    });
    expect(await r.menu(PHOTO, "image/webp")).toEqual([
      { number: "4", name: "Margherita", description: "tomato", price_cents: 800, unsure: false },
    ]);
  });

  it("reports a refused key, and treats a refusal, a cut-off answer or a failure as no reading", async () => {
    const err = (status: number, type: string) => ({
      status,
      body: { type: "error", error: { type, message: "no" } },
    });
    await expect(
      anthropicReader("k", { fetch: fakeFetch(err(401, "authentication_error"), []) }).receipt(
        PHOTO,
        "image/png",
      ),
    ).rejects.toBeInstanceOf(ReaderKeyRejected);
    await expect(
      anthropicReader("k", { fetch: fakeFetch(err(529, "overloaded_error"), []) }).receipt(
        PHOTO,
        "image/png",
      ),
    ).rejects.toBeInstanceOf(ReaderFailed);
    await expect(
      anthropicReader("k", { fetch: fakeFetch({ body: message("", "refusal") }, []) }).receipt(
        PHOTO,
        "image/png",
      ),
    ).rejects.toBeInstanceOf(ReaderFailed);
    await expect(
      anthropicReader("k", { fetch: fakeFetch({ body: message("{", "max_tokens") }, []) }).menu(
        PHOTO,
        "image/png",
      ),
    ).rejects.toBeInstanceOf(ReaderFailed);
  });
});
