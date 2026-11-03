/** Event bus on Valkey Streams: `events:<module>`, one field `event` (contracts/admin.md). */
import { getCorrelationId, newId } from "./context.js";
import { utcNowIso } from "./log.js";
import type { Logger } from "./log.js";
import type { StreamStore } from "./store.js";

/** Approximate length each `events:<module>` stream is trimmed to on publish. */
export const STREAM_MAXLEN = 10000;
export const DEDUPE_SIZE = 10000;
export const EVENT_TYPE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$/;

export function streamName(module: string): string {
  return `events:${module}`;
}

export class InvalidEventType extends Error {
  override name = "InvalidEventType";
}

export class InvalidEnvelope extends Error {
  override name = "InvalidEnvelope";
}

export interface Event {
  id: string;
  type: string;
  version: number;
  time: string;
  source: string;
  correlation_id?: string;
  data: Record<string, unknown>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Parse and check an envelope; unknown fields are ignored. */
export function parseEnvelope(raw: string): Event {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new InvalidEnvelope("not JSON");
  }
  if (!isObject(body)) throw new InvalidEnvelope("not an object");
  const required = ["id", "type", "version", "time", "source", "data"];
  const missing = required.filter((f) => !(f in body));
  if (missing.length > 0) throw new InvalidEnvelope(`missing field(s): ${missing.join(", ")}`);
  const { id, type, version, time, source, data, correlation_id } = body;
  const checks: Record<string, boolean> = {
    id: typeof id === "string" && id !== "",
    type: typeof type === "string" && EVENT_TYPE_RE.test(type),
    version: typeof version === "number" && Number.isInteger(version) && version >= 1,
    time: typeof time === "string",
    source: typeof source === "string",
    data: isObject(data),
    correlation_id: correlation_id === undefined || typeof correlation_id === "string",
  };
  const bad = Object.keys(checks).filter((k) => !checks[k]);
  if (bad.length > 0) throw new InvalidEnvelope(`invalid field(s): ${bad.join(", ")}`);
  const event = { id, type, version, time, source, data } as Omit<Event, "correlation_id">;
  if (event.type.split(".")[0] !== event.source) {
    throw new InvalidEnvelope("source does not match the type's module");
  }
  return typeof correlation_id === "string" ? { ...event, correlation_id } : event;
}

export type Handler = (event: Event) => Promise<void> | void;

export interface PublishOptions {
  version: number;
  correlationId?: string;
}

export class Bus {
  constructor(
    readonly store: StreamStore,
    readonly module: string,
    private readonly log?: Logger,
  ) {}

  async publish(
    type: string,
    data: Record<string, unknown>,
    options: PublishOptions,
  ): Promise<Event> {
    if (!EVENT_TYPE_RE.test(type)) {
      throw new InvalidEventType(`"${type}" is not <module>.<noun>.<past-tense verb>`);
    }
    if (type.split(".")[0] !== this.module) {
      throw new InvalidEventType(`"${type}" does not start with this module (${this.module})`);
    }
    if (!Number.isInteger(options.version) || options.version < 1) {
      throw new RangeError("version must be an integer >= 1");
    }
    const correlationId = options.correlationId ?? getCorrelationId();
    const event: Event = {
      id: newId(),
      type,
      version: options.version,
      time: utcNowIso(),
      source: this.module,
      ...(correlationId === undefined ? {} : { correlation_id: correlationId }),
      data,
    };
    await this.store.xadd(
      streamName(this.module),
      { event: JSON.stringify(event) },
      { maxlen: STREAM_MAXLEN, approximate: true },
    );
    return event;
  }

  subscribe(
    modules: string[],
    handler: Handler,
    options: { fromId?: string; blockMs?: number } = {},
  ): Subscription {
    return new Subscription(
      this.store,
      modules,
      handler,
      options.fromId ?? "$",
      options.blockMs ?? 5000,
      this.log,
    );
  }
}

/** Reads streams in the background until closed. */
export class Subscription {
  private readonly positions: Record<string, string> = {};
  private readonly seen = new Set<string>();
  private closed = false;
  readonly done: Promise<void>;

  constructor(
    private readonly store: StreamStore,
    modules: string[],
    private readonly handler: Handler,
    fromId: string,
    private readonly blockMs: number,
    private readonly log?: Logger,
  ) {
    for (const m of modules) this.positions[streamName(m)] = fromId;
    this.done = this.run();
  }

  private isClosed(): boolean {
    return this.closed;
  }

  private isDuplicate(id: string): boolean {
    if (this.seen.has(id)) {
      this.seen.delete(id);
      this.seen.add(id);
      return true;
    }
    this.seen.add(id);
    if (this.seen.size > DEDUPE_SIZE) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return false;
  }

  private async run(): Promise<void> {
    let backoff = 500;
    while (!this.closed) {
      let batches;
      try {
        batches = await this.store.xread(this.positions, { blockMs: this.blockMs, count: 100 });
        backoff = 500;
      } catch (err) {
        if (this.isClosed()) return;
        this.log?.error({ err, retry_in_ms: backoff }, "bus read failed; retrying");
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 10000);
        continue;
      }
      for (const [stream, entries] of batches) {
        for (const [entryId, fields] of entries) {
          if (this.isClosed()) return;
          this.positions[stream] = entryId;
          await this.deliver(stream, entryId, fields);
        }
      }
    }
  }

  private async deliver(
    stream: string,
    entryId: string,
    fields: Record<string, string>,
  ): Promise<void> {
    let event: Event;
    try {
      event = parseEnvelope(fields.event ?? "");
    } catch (err) {
      this.log?.warn({ stream, entry: entryId, reason: String(err) }, "skipped invalid event");
      return;
    }
    if (this.isDuplicate(event.id)) return;
    try {
      await this.handler(event);
    } catch (err) {
      this.log?.error({ err, event_id: event.id, type: event.type }, "event handler failed");
    }
  }

  /** Stop after the current read (at most blockMs). */
  async close(): Promise<void> {
    this.closed = true;
    await this.done;
  }
}
