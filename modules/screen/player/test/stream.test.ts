import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Answer } from "../src/api.js";
import type { SseMessage } from "../src/sse.js";
import { CONNECT_MS, SILENCE_MS, StreamClient, backoffMs } from "../src/stream.js";

/** A stream answer the test writes into. */
function live(): { response: Response; write(text: string): void; end(): void } {
  let control!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      control = c;
    },
  });
  const enc = new TextEncoder();
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    write: (text) => {
      control.enqueue(enc.encode(text));
    },
    end: () => {
      control.close();
    },
  };
}

function problem(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function recorder() {
  const log: string[] = [];
  const messages: SseMessage[] = [];
  const refused: Answer[] = [];
  return {
    log,
    messages,
    refused,
    handlers: {
      open: () => log.push("open"),
      message: (m: SseMessage) => messages.push(m),
      lost: () => log.push("lost"),
      failed: (n: number) => log.push(`failed ${n}`),
      refused: (a: Answer) => refused.push(a),
    },
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

describe("the reconnect delay", () => {
  it("starts at the server's retry, doubles per failure, stops at 30 s, jitters in the upper half", () => {
    expect(backoffMs(0, 2000, () => 1)).toBe(2000);
    expect(backoffMs(1, 2000, () => 0)).toBe(1000);
    expect(backoffMs(3, 2000, () => 1)).toBe(8000);
    expect(backoffMs(9, 2000, () => 1)).toBe(30_000);
    expect(backoffMs(9, 2000, () => 0)).toBe(15_000);
  });
});

describe("the stream client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands on messages and resumes with the last id after a drop", async () => {
    const first = live();
    const second = live();
    const fetchFn = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(second.response);
    const r = recorder();
    const client = new StreamClient(fetchFn, r.handlers, () => 1);
    client.start();
    await flush();
    first.write("retry: 2000\n\nid: main.e1.3\nevent: state\ndata: {}\n\n");
    await flush();
    expect(r.messages).toEqual([{ event: "state", data: "{}", id: "main.e1.3" }]);
    first.end();
    await flush();
    expect(r.log).toEqual(["open", "lost"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const headers = fetchFn.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(headers["last-event-id"]).toBe("main.e1.3");
    client.stop();
  });

  it("counts failed connects and backs off between them", async () => {
    const fetchFn = vi
      .fn<(url: string) => Promise<Response>>()
      .mockRejectedValue(new TypeError("offline"));
    const r = recorder();
    const client = new StreamClient(fetchFn, r.handlers, () => 1);
    client.start();
    await flush();
    expect(r.log).toEqual(["failed 1"]);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.log).toEqual(["failed 1", "failed 2"]);
    await vi.advanceTimersByTimeAsync(4000);
    expect(r.log).toEqual(["failed 1", "failed 2", "failed 3"]);
    client.stop();
  });

  it("treats a 5xx as a failed connect, not as a refusal", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(problem(503, "unavailable")));
    const r = recorder();
    const client = new StreamClient(fetchFn, r.handlers, () => 1);
    client.start();
    await flush();
    expect(r.log).toEqual(["failed 1"]);
    expect(r.refused).toEqual([]);
    client.stop();
  });

  it("stops on an answer about the device and passes it on", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(problem(409, "device_moved")));
    const r = recorder();
    const client = new StreamClient(fetchFn, r.handlers, () => 1);
    client.start();
    await flush();
    expect(r.refused.map((a) => [a.status, a.code])).toEqual([[409, "device_moved"]]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("counts a connect that never gets an answer as failed, so the reconnects go on", async () => {
    // A stalled upstream or a half-open connection: nothing ever settles, not even on abort.
    const fetchFn = vi.fn(() => new Promise<Response>(() => undefined));
    const r = recorder();
    const client = new StreamClient(fetchFn, r.handlers, () => 1);
    client.start();
    await vi.advanceTimersByTimeAsync(CONNECT_MS - 1);
    expect(r.log).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.log).toEqual(["failed 1"]);
    await vi.advanceTimersByTimeAsync(2000 + CONNECT_MS);
    expect(r.log).toEqual(["failed 1", "failed 2"]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    client.stop();
  });

  it("ignores a refusal that arrives for a connect the client has replaced", async () => {
    let finish!: () => void;
    const late = new ReadableStream<Uint8Array>({
      start(c) {
        finish = () => {
          c.enqueue(new TextEncoder().encode('{"error":{"code":"device_moved"}}'));
          c.close();
        };
      },
    });
    const second = live();
    const fetchFn = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(late, { status: 409, headers: { "content-type": "application/json" } }),
      )
      .mockResolvedValueOnce(second.response);
    const r = recorder();
    const client = new StreamClient(fetchFn, r.handlers, () => 1);
    client.start();
    await flush();
    client.stop();
    client.start();
    await flush();
    finish();
    await flush();
    expect(r.refused).toEqual([]);
    expect(r.log).toEqual(["open"]);
    second.write("event: state\ndata: {}\n\n");
    await flush();
    expect(r.messages).toHaveLength(1);
    client.stop();
  });

  it("gives up on a stream that goes silent and connects again", async () => {
    const first = live();
    const second = live();
    const fetchFn = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockImplementationOnce((_url, init) => {
        init?.signal?.addEventListener("abort", () => {
          first.end();
        });
        return Promise.resolve(first.response);
      })
      .mockResolvedValueOnce(second.response);
    const r = recorder();
    const client = new StreamClient(fetchFn, r.handlers, () => 1);
    client.start();
    await flush();
    await vi.advanceTimersByTimeAsync(SILENCE_MS);
    expect(r.log).toEqual(["open", "lost"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    client.stop();
  });
});
