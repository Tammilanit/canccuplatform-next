import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALL_TIMEOUT_MS } from "../src/api.js";
import type { Answer } from "../src/api.js";
import { Heartbeat } from "../src/heartbeat.js";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const report = () => ({
  state_version: 7,
  bundle_version: "1.2.3",
  theme_revision: 2,
  viewport: { width: 1920, height: 1080 },
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

describe("the heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the page and learns the clock offset from server_time and the round trip", async () => {
    let clock = 1_000_000;
    const bodies: Record<string, unknown>[] = [];
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
      // 200 ms round trip; the server's clock is 5 s ahead of the device's.
      clock += 200;
      return Promise.resolve(
        json(200, { server_time: new Date(clock - 100 + 5000).toISOString() }),
      );
    });
    const beat = new Heartbeat(
      fetchFn,
      report,
      () => undefined,
      () => clock,
    );
    beat.start(15_000);
    await flush();
    expect(beat.offsetMs).toBe(5000);
    expect(beat.serverNow()).toBe(clock + 5000);
    expect(bodies[0]).toMatchObject({
      state_version: 7,
      bundle_version: "1.2.3",
      theme_revision: 2,
      viewport: { width: 1920, height: 1080 },
      audio_unlocked: false,
      client_time: new Date(1_000_000).toISOString(),
      errors: [],
    });
    expect(bodies[0]).not.toHaveProperty("rtt_ms");
    expect(String(bodies[0]?.instance_id)).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(bodies[1]).toMatchObject({ rtt_ms: 200, instance_id: bodies[0]?.instance_id });
    beat.stop();
  });

  it("sends no beat while the last is open, and gives that one up after the call timeout", async () => {
    const fetchFn = vi.fn(() => new Promise<Response>(() => undefined));
    const beat = new Heartbeat(fetchFn, report, () => undefined);
    beat.start(4000);
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS - 1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(12_000 - (CALL_TIMEOUT_MS - 1));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    beat.stop();
  });

  it("keeps the last offset when a beat gets no answer", async () => {
    const fetchFn = vi
      .fn<(url: string) => Promise<Response>>()
      .mockResolvedValueOnce(json(200, { server_time: new Date(3000).toISOString() }))
      .mockRejectedValueOnce(new TypeError("offline"));
    const beat = new Heartbeat(
      fetchFn,
      report,
      () => undefined,
      () => 1000,
    );
    beat.start(15_000);
    await flush();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(beat.offsetMs).toBe(2000);
    beat.stop();
  });

  it("stops and passes on an answer about the device", async () => {
    const refused: Answer[] = [];
    const fetchFn = vi.fn(() =>
      Promise.resolve(json(403, { error: { code: "venue_ip_refused", message: "x" } })),
    );
    const beat = new Heartbeat(fetchFn, report, (a) => refused.push(a));
    beat.start(15_000);
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refused.map((a) => a.code)).toEqual(["venue_ip_refused"]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
