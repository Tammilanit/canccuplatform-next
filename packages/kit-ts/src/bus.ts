/**
 * Event bus on Valkey Streams, one field `event` (contracts/admin.md). Tenant events go to
 * `t:<tenant>:events:<module>`, platform events to `events:<module>` (contracts/events.md).
 */
import { getCorrelationId, newId } from "./context.js";
import { utcNowIso } from "./log.js";
import type { Logger } from "./log.js";
import type { StreamStore } from "./store.js";
import {
  NoTenant,
  currentTenant,
  isTenantId,
  platformStream,
  tenantStream,
  withTenant,
} from "./tenant.js";

/** Approximate length each stream, platform or tenant, is trimmed to on publish. */
export const STREAM_MAXLEN = 10000;
export const DEDUPE_SIZE = 10000;
export const EVENT_TYPE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$/;

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
  /** Set on tenant events, absent on platform events. */
  tenant?: string;
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
  const { id, type, version, time, source, data, correlation_id, tenant } = body;
  const checks: Record<string, boolean> = {
    id: typeof id === "string" && id !== "",
    type: typeof type === "string" && EVENT_TYPE_RE.test(type),
    version: typeof version === "number" && Number.isInteger(version) && version >= 1,
    time: typeof time === "string",
    source: typeof source === "string",
    data: isObject(data),
    correlation_id: correlation_id === undefined || typeof correlation_id === "string",
    tenant: tenant === undefined || (typeof tenant === "string" && isTenantId(tenant)),
  };
  const bad = Object.keys(checks).filter((k) => !checks[k]);
  if (bad.length > 0) throw new InvalidEnvelope(`invalid field(s): ${bad.join(", ")}`);
  const event = {
    id,
    type,
    version,
    time,
    source,
    ...(typeof tenant === "string" ? { tenant } : {}),
    ...(typeof correlation_id === "string" ? { correlation_id } : {}),
    data,
  } as Event;
  if (event.type.split(".")[0] !== event.source) {
    throw new InvalidEnvelope("source does not match the type's module");
  }
  return event;
}

export type Handler = (event: Event) => Promise<void> | void;

export interface PublishOptions {
  version: number;
  correlationId?: string;
  /** Defaults to the current tenant (withTenant). */
  tenant?: string;
  /**
   * A platform event, which concerns no single tenant. Only a module whose contract says so emits
   * them; without this flag a missing tenant is an error, never a silent platform event.
   */
  platform?: boolean;
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
    const tenant = options.platform === true ? undefined : (options.tenant ?? currentTenant());
    if (options.platform === true && options.tenant !== undefined) {
      throw new RangeError("a platform event has no tenant");
    }
    if (options.platform !== true && tenant === undefined) throw new NoTenant();
    const correlationId = options.correlationId ?? getCorrelationId();
    const event: Event = {
      id: newId(),
      type,
      version: options.version,
      time: utcNowIso(),
      source: this.module,
      ...(tenant === undefined ? {} : { tenant }),
      ...(correlationId === undefined ? {} : { correlation_id: correlationId }),
      data,
    };
    await this.store.xadd(
      tenant === undefined ? platformStream(this.module) : tenantStream(this.module, tenant),
      { event: JSON.stringify(event) },
      { maxlen: STREAM_MAXLEN, approximate: true },
    );
    return event;
  }

  /** Read other modules' platform streams `events:<module>`. */
  subscribe(
    modules: string[],
    handler: Handler,
    options: { fromId?: string; blockMs?: number } = {},
  ): Subscription {
    const streams = Object.fromEntries(
      modules.map((m) => [platformStream(m), options.fromId ?? "$"]),
    );
    return new Subscription(this.store, streams, handler, options.blockMs ?? 5000, this.log);
  }

  /**
   * Read other modules' tenant streams for every tenant, now and later (0013 item 7): the handler
   * runs inside withTenant(event.tenant). Streams that exist at start begin at `fromId`; a tenant
   * found later (tenants.tenant.created, or a rescan) is read from its start.
   */
  subscribeTenants(
    modules: string[],
    handler: Handler,
    options: { fromId?: string; blockMs?: number; rescanMs?: number } = {},
  ): TenantSubscription {
    return new TenantSubscription(this.store, modules, handler, {
      fromId: options.fromId ?? "$",
      blockMs: options.blockMs ?? 5000,
      rescanMs: options.rescanMs ?? 30000,
      ...(this.log === undefined ? {} : { log: this.log }),
    });
  }
}

/** Reads streams in the background until closed. */
export class Subscription {
  protected readonly positions: Record<string, string>;
  private readonly seen = new Set<string>();
  private closed = false;
  readonly done: Promise<void>;

  constructor(
    private readonly store: StreamStore,
    streams: Record<string, string>,
    protected readonly handler: Handler,
    private readonly blockMs: number,
    protected readonly log?: Logger,
  ) {
    this.positions = { ...streams };
    // Start after the constructor (and a subclass's) has finished setting its fields.
    this.done = Promise.resolve().then(() => this.run());
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

  /**
   * Replace `$` with the stream's newest id. XREAD moves only the positions of streams that
   * returned entries, so a stream left at `$` would mean "from now" again on every read and lose
   * whatever arrived while a handler of another stream ran.
   */
  private async anchorNewStreams(): Promise<void> {
    for (const [stream, id] of Object.entries(this.positions)) {
      if (id === "$") this.positions[stream] = await this.store.lastEntryId(stream);
    }
  }

  /** Called before every read. */
  protected async beforeRead(): Promise<void> {}

  /** Hand one parsed, new event to the handler. */
  protected async dispatch(_stream: string, event: Event): Promise<void> {
    await this.handler(event);
  }

  private async run(): Promise<void> {
    let backoff = 500;
    while (!this.closed) {
      let batches;
      try {
        await this.beforeRead();
        await this.anchorNewStreams();
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
          // A stream removed while its batch was in flight stays removed.
          if (!(stream in this.positions)) break;
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
      await this.dispatch(stream, event);
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

const TENANT_STREAM_RE = /^t:([^:]+):events:([^:]+)$/;
const TENANTS_PLATFORM = platformStream("tenants");

/** Tenant streams of some modules, for every tenant; see Bus.subscribeTenants. */
export class TenantSubscription extends Subscription {
  private readonly deleted = new Set<string>();
  private lastScan = -Infinity;
  private scanFrom: string;

  constructor(
    private readonly tenantStore: StreamStore,
    private readonly modules: string[],
    handler: Handler,
    private readonly options: { fromId: string; blockMs: number; rescanMs: number; log?: Logger },
  ) {
    // The tenants platform stream announces new and deleted tenants.
    super(tenantStore, { [TENANTS_PLATFORM]: "$" }, handler, options.blockMs, options.log);
    // Checked here, not at the first scan: a bad name would fail every read, forever.
    for (const module of modules) platformStream(module);
    this.scanFrom = options.fromId;
  }

  private addTenant(tenant: string, fromId: string): void {
    if (!isTenantId(tenant) || this.deleted.has(tenant)) return;
    for (const module of this.modules) {
      const stream = tenantStream(module, tenant);
      if (!(stream in this.positions)) this.positions[stream] = fromId;
    }
  }

  protected override async beforeRead(): Promise<void> {
    if (Date.now() - this.lastScan < this.options.rescanMs) return;
    const from = this.scanFrom;
    // Only a first scan that runs at start may skip history. After any attempt, also a failed
    // one, a stream found later is read from its start, so a late first scan skips nothing.
    this.scanFrom = "0";
    // One scan for all modules; lastScan moves only on success, so a failure retries next read.
    const modules = new Set(this.modules);
    for (const stream of await this.tenantStore.scan("t:*:events:*")) {
      const match = TENANT_STREAM_RE.exec(stream);
      if (match?.[1] !== undefined && modules.has(match[2] ?? "")) this.addTenant(match[1], from);
    }
    this.lastScan = Date.now();
  }

  protected override async dispatch(stream: string, event: Event): Promise<void> {
    if (stream === TENANTS_PLATFORM) {
      const tenant = event.data.tenant_id;
      if (typeof tenant !== "string" || !isTenantId(tenant)) return;
      if (event.type === "tenants.tenant.created") {
        this.deleted.delete(tenant);
        this.addTenant(tenant, "0");
      }
      if (event.type === "tenants.tenant.deleted") {
        this.deleted.add(tenant);
        for (const module of this.modules) {
          Reflect.deleteProperty(this.positions, tenantStream(module, tenant));
        }
      }
      return;
    }
    const tenant = TENANT_STREAM_RE.exec(stream)?.[1];
    if (tenant === undefined || event.tenant !== tenant) {
      this.log?.warn(
        { stream, event_id: event.id, tenant: event.tenant },
        "dropped event of another tenant",
      );
      return;
    }
    await withTenant(tenant, () => this.handler(event));
  }
}
