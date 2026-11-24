/**
 * The Anthropic reader against a fake `fetch` (the plan: no test calls the provider): the request
 * holds the photo and fixed instructions only, the answer is checked as outside input, and a
 * refused key, a refusal and a failure each end as the reader's own error.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicReader } from "../src/anthropic-reader.js";
import { ReaderFailed, ReaderKeyRejected, timeoutFor } from "../src/reader.js";

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(
  answer: { status?: number; body: unknown; headers?: Record<string, string> },
  sent: Sent[] = [],
): typeof fetch {
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
    return Promise.resolve(
      Response.json(answer.body, { status: answer.status ?? 200, headers: answer.headers ?? {} }),
    );
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
  usage: { input_tokens: 1234, output_tokens: 56 },
});

const receiptJson = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ readable: true, reason: null, total_cents: 1200, lines: [], ...o });

const PHOTO = Buffer.from("photo-bytes");

describe("the Anthropic reader", () => {
  it("sends the photo and fixed instructions to Claude Haiku 5.5, with the key, and nothing else", async () => {
    const sent: Sent[] = [];
    const r = anthropicReader("sk-ant-test", {
      fetch: fakeFetch({ body: message(receiptJson()) }, sent),
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
      readable: true,
      reason: null,
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
    const { reading: read } = await r.receipt(PHOTO, "image/png");
    expect(read.total_cents).toBeNull();
    expect(read.lines).toHaveLength(2);
    expect(read.lines[0]?.text).toHaveLength(120);
    expect(read.lines[1]).toMatchObject({ quantity: 1, kind: "item", amount_cents: -100 });
  });

  it("reads a menu page into items, leaving out those without a number", async () => {
    const answer = {
      readable: true,
      reason: null,
      items: [
        { number: "4", name: "Margherita", description: "tomato", price_cents: 800, unsure: false },
        { number: "", name: "Drinks", description: null, price_cents: null, unsure: false },
      ],
    };
    const r = anthropicReader("k", {
      fetch: fakeFetch({ body: message(JSON.stringify(answer)) }, []),
    });
    expect((await r.menu([{ image: PHOTO, type: "image/webp" }])).reading.items).toEqual([
      { number: "4", name: "Margherita", description: "tomato", price_cents: 800, unsure: false },
    ]);
  });

  it("answers the tokens the read used", async () => {
    const r = anthropicReader("k", { fetch: fakeFetch({ body: message(receiptJson()) }) });
    const { usage } = await r.receipt(PHOTO, "image/png");
    expect(usage).toMatchObject({ input_tokens: 1234, output_tokens: 56 });
    expect(usage.ms).toBeGreaterThanOrEqual(0);
  });

  it("sends every page of a menu in one request, in order, with only the fixed instructions", async () => {
    const sent: Sent[] = [];
    const answer = JSON.stringify({ readable: true, reason: null, items: [] });
    const r = anthropicReader("k", { fetch: fakeFetch({ body: message(answer) }, sent) });
    const pages = ["one", "two", "three"].map((p) => ({
      image: Buffer.from(p),
      type: "image/jpeg",
    }));
    await r.menu(pages);
    expect(sent).toHaveLength(1);
    const content = (
      (sent[0] as Sent).body.messages as {
        content: { type: string; text?: string; source?: { data: string } }[];
      }[]
    )[0]?.content;
    expect(content?.map((c) => c.type)).toEqual(["image", "image", "image", "text"]);
    expect(content?.slice(0, 3).map((c) => c.source?.data)).toEqual(
      pages.map((p) => p.image.toString("base64")),
    );
    const again: Sent[] = [];
    await anthropicReader("k", { fetch: fakeFetch({ body: message(answer) }, again) }).menu(
      pages.slice(0, 1),
    );
    const text = (s: Sent) =>
      (s.body.messages as { content: { type: string; text?: string }[] }[])[0]?.content.find(
        (c) => c.type === "text",
      )?.text;
    // The same fixed words for one page and for three: nothing of ours goes along.
    expect(text(sent[0] as Sent)).toBe(text(again[0] as Sent));
  });

  const failure = async (answer: Parameters<typeof fakeFetch>[0]) =>
    anthropicReader("k", { fetch: fakeFetch(answer) })
      .receipt(PHOTO, "image/png")
      .then(
        () => null,
        (e: unknown) => e,
      );
  const apiError = (
    status: number,
    type: string,
    msg = "no",
    headers?: Record<string, string>,
  ) => ({
    status,
    body: { type: "error", error: { type, message: msg } },
    ...(headers === undefined ? {} : { headers }),
  });

  it("stops on a key the provider refuses (401, 403)", async () => {
    expect(await failure(apiError(401, "authentication_error"))).toBeInstanceOf(ReaderKeyRejected);
    expect(await failure(apiError(403, "permission_error"))).toBeInstanceOf(ReaderKeyRejected);
  });

  it("says out of credit when the balance or the spend limit is used up", async () => {
    const low = await failure(
      apiError(400, "invalid_request_error", "Your credit balance is too low to access the API."),
    );
    expect(low).toMatchObject({ reason: "out_of_credit", code: "reader_failed", status: 502 });
    const limit = await failure(
      apiError(429, "rate_limit_error", "You have reached your specified API usage limits."),
    );
    expect(limit).toMatchObject({ reason: "out_of_credit" });
  });

  it("says rate limited, with the provider's wait", async () => {
    const e = await failure(apiError(429, "rate_limit_error", "slow down", { "retry-after": "7" }));
    expect(e).toMatchObject({ reason: "rate_limited", retryAfterS: 7 });
    expect((e as ReaderFailed).toBody().error).toMatchObject({
      code: "reader_failed",
      reason: "rate_limited",
      retry_after_s: 7,
    });
  });

  it("says the service is down on a 500 or an overload (529)", async () => {
    expect(await failure(apiError(500, "api_error"))).toMatchObject({ reason: "service_down" });
    expect(await failure(apiError(529, "overloaded_error"))).toMatchObject({
      reason: "service_down",
    });
  });

  describe("a provider that never answers", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("times out after timeoutFor(pages)", async () => {
      vi.useFakeTimers();
      const never: typeof fetch = (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      const reading = anthropicReader("k", { fetch: never })
        .receipt(PHOTO, "image/png")
        .then(
          () => null,
          (e: unknown) => e,
        );
      await vi.advanceTimersByTimeAsync(timeoutFor(1) - 1000);
      let settled = false;
      void reading.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await reading).toMatchObject({ reason: "timeout" });
    });
  });

  it("grows the time limit with the pages, up to 100 s", () => {
    expect(timeoutFor(1)).toBe(50_000);
    expect(timeoutFor(3)).toBe(70_000);
    expect(timeoutFor(6)).toBe(100_000);
    expect(timeoutFor(20)).toBe(100_000);
  });

  it("says declined when the model refuses, with what it used", async () => {
    const e = await failure({ body: message("", "refusal") });
    expect(e).toMatchObject({ reason: "declined" });
    expect((e as ReaderFailed).usage).toMatchObject({ input_tokens: 1234 });
  });

  it("says unreadable with the model's own reason", async () => {
    const e = await failure({
      body: message(
        receiptJson({ readable: false, reason: "This is a photo of a cat, not a receipt." }),
      ),
    });
    expect(e).toMatchObject({
      reason: "unreadable",
      message: "This is a photo of a cat, not a receipt.",
    });
    expect((e as ReaderFailed).usage).toMatchObject({ output_tokens: 56 });
  });

  it("says failed on a cut-off answer or one that is not JSON", async () => {
    expect(await failure({ body: message("{", "max_tokens") })).toMatchObject({ reason: "failed" });
    expect(await failure({ body: message("not json") })).toMatchObject({ reason: "failed" });
  });

  it("marks the lines the photo left unsure, a partly read receipt", async () => {
    const r = anthropicReader("k", {
      fetch: fakeFetch({
        body: message(
          receiptJson({
            lines: [
              {
                text: "1 x 4 Marg",
                number: "4",
                name: "Marg",
                quantity: 1,
                amount_cents: 800,
                kind: "item",
                unsure: true,
              },
            ],
          }),
        ),
      }),
    });
    expect((await r.receipt(PHOTO, "image/png")).reading.lines[0]).toMatchObject({ unsure: true });
  });
});
