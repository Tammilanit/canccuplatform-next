/**
 * The push channel's client (contracts/screen.md, Composed state and the push channel): one SSE
 * connection at a time, resumed with `Last-Event-ID`, reconnected with backoff and jitter up to
 * 30 s. A 401, 403 or 409 is about the device, not the network: the stream stops and the player
 * decides which frame to show.
 */
import { drain, fetchUntil, isDeviceAnswer, readAnswer } from "./api.js";
import type { Answer, Fetch } from "./api.js";
import { SseParser } from "./sse.js";
import type { SseMessage } from "./sse.js";

export const STREAM_PATH = "/api/screen/device/stream";
const MAX_DELAY_MS = 30_000;
/** The server pings every 15 s: three missed pings mean a connection that died without closing. */
export const SILENCE_MS = 45_000;
/**
 * A connect that has no headers by then has failed: it counts toward the poll fallback and is
 * tried again, instead of waiting on a stalled upstream or a half-open connection for good.
 */
export const CONNECT_MS = 15_000;

export interface StreamHandlers {
  open(): void;
  message(message: SseMessage): void;
  /** The stream is gone (it closed, failed or went silent); a reconnect is scheduled. */
  lost(): void;
  /** Connects in a row that got no stream; the player polls the state from the third on. */
  failed(count: number): void;
  /** An answer about the device (401, 403, 409): the stream has stopped. */
  refused(answer: Answer): void;
}

/**
 * The wait before the next connect: `retry` after a stream that was open, then doubling per failed
 * connect up to 30 s, each a random point in its upper half, so a venue's screens that lost the
 * uplink together do not all come back in the same second.
 */
export function backoffMs(failures: number, retryMs: number, random: () => number): number {
  const base = Math.min(MAX_DELAY_MS, retryMs * 2 ** Math.max(0, failures - 1));
  return Math.round(base / 2 + (random() * base) / 2);
}

export class StreamClient {
  lastEventId = "";
  private retryMs = 2000;
  private failures = 0;
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(
    private readonly fetchFn: Fetch,
    private readonly on: StreamHandlers,
    private readonly random: () => number = Math.random,
    /** A device's channel, or a zone's for a signed-in person (the virtual screen). */
    private readonly path: string = STREAM_PATH,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    clearTimeout(this.watchdog);
    this.abort?.abort();
    this.abort = null;
  }

  private async connect(): Promise<void> {
    const abort = new AbortController();
    this.abort = abort;
    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (this.lastEventId !== "") headers["last-event-id"] = this.lastEventId;
    const connectTimer = setTimeout(() => {
      abort.abort();
    }, CONNECT_MS);
    const stale = (): boolean => !this.running || abort !== this.abort;
    let response: Response;
    try {
      response = await fetchUntil(this.fetchFn, this.path, {
        headers,
        credentials: "same-origin",
        cache: "no-store",
        signal: abort.signal,
      });
    } catch {
      clearTimeout(connectTimer);
      if (!stale()) this.fail();
      return;
    }
    if (stale()) {
      clearTimeout(connectTimer);
      drain(response);
      return;
    }
    if (response.status !== 200 || response.body === null) {
      const answer = await readAnswer(response);
      clearTimeout(connectTimer);
      // A connect that was replaced meanwhile must not stop the stream that replaced it.
      if (stale()) return;
      if (isDeviceAnswer(answer.status)) {
        this.stop();
        this.on.refused(answer);
      } else {
        this.fail();
      }
      return;
    }
    clearTimeout(connectTimer);
    this.failures = 0;
    this.on.open();
    await this.read(response.body, abort);
  }

  private async read(body: ReadableStream<Uint8Array>, abort: AbortController): Promise<void> {
    const parser = new SseParser();
    const decoder = new TextDecoder();
    const reader = body.getReader();
    const quiet = (): void => {
      clearTimeout(this.watchdog);
      this.watchdog = setTimeout(() => {
        abort.abort();
      }, SILENCE_MS);
    };
    quiet();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        quiet();
        for (const message of parser.push(decoder.decode(value, { stream: true }))) {
          if (message.id !== "") this.lastEventId = message.id;
          if (!this.running || abort !== this.abort) return;
          this.on.message(message);
        }
        if (parser.retry !== null) this.retryMs = parser.retry;
      }
    } catch {
      // Aborted (stop, or the watchdog) or the connection dropped: both end the stream below.
    } finally {
      clearTimeout(this.watchdog);
      reader.cancel().catch(() => undefined);
    }
    if (!this.running || abort !== this.abort) return;
    this.on.lost();
    this.schedule();
  }

  private fail(): void {
    if (!this.running) return;
    this.failures += 1;
    this.on.failed(this.failures);
    this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        if (this.running) void this.connect();
      },
      backoffMs(this.failures, this.retryMs, this.random),
    );
  }
}
