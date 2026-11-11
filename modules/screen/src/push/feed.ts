/**
 * What every open push stream shares (contracts/screen.md, Push and Resume): a device's
 * (`stream.ts`) and a signed-in person's view of a zone (`session.ts`). Everything a stream does
 * runs one step at a time, in order, inside its event: the first state or the resumed changes,
 * the zone's changes as they are published, and the `ping`, which also catches up on anything a
 * lost pub/sub message left out.
 */
import { PassThrough } from "node:stream";
import { withTenant } from "@canccu/kit";
import type { Bus, Logger, TenantContext } from "@canccu/kit";
import type { ComposeDeps } from "../compose/state.js";
import { keys } from "./store.js";
import type { Entry, Fanout, Message, Orientation, ZoneRecord } from "./store.js";

export const PING_MS = 15_000;
/** A screen that reads nothing for this long is gone; its buffered frames are dropped with it. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
// The epoch is base64url (src/zones.ts, newEpoch), so `-` and `_` belong to it; neither part has a `.`.
const LAST_ID_RE = /^([a-z0-9][a-z0-9_-]{1,31})\.([A-Za-z0-9_-]{1,32})\.([0-9]{1,18})$/;

export interface StreamDeps extends ComposeDeps {
  fanout: Fanout;
  bus: Bus;
  log?: Logger;
  streamPingMs?: number;
  /** The event a hostname serves now, as a request would resolve it; null when none. */
  contextOf(host: string): Promise<TenantContext | null>;
  /** A stream was placed in a zone whose content next changes by itself at `at` (PushHub.plan). */
  onPlaced?(tenant: string, zone: string, at: number | null): void;
}

export interface FeedRequest {
  /** As the connect resolved it; each `ping` resolves it again. */
  ctx: TenantContext;
  host: string;
}

/** Where a stream stands after placing it: its zone's record and the whole state it would send. */
export interface FeedPlace {
  zoneKey: string | null;
  orientation: Orientation;
  record: ZoneRecord | null;
  state: Record<string, unknown>;
}

export abstract class Feed<R extends FeedRequest = FeedRequest> {
  readonly out = new PassThrough();
  zoneKey: string | null = null;
  /** Whether it follows another device's zone, so a reassignment of any device may move it. */
  mirror = false;
  protected epoch = "0";
  protected version = 0;
  protected orientation: Orientation = "landscape";
  protected closed = false;
  private chain: Promise<void> = Promise.resolve();
  private stopZone: (() => void) | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly onClose: (() => void)[] = [];

  constructor(
    protected readonly deps: StreamDeps,
    readonly req: R,
  ) {}

  get tenant(): string {
    return this.req.ctx.tenant_id;
  }
  /** The device whose events (revoked, moved, assigned) concern this stream; null for none. */
  abstract get deviceId(): string | null;

  /** Where the stream is now: its zone, freshly built, and the whole state. */
  protected abstract locate(): Promise<FeedPlace>;
  /** The zone's stored record as this stream's whole state. */
  protected abstract stateOf(record: ZoneRecord): Record<string, unknown>;
  protected abstract ping(): Promise<void>;
  /** Runs once the first state or the resumed changes are out. */
  protected abstract opened(): Promise<void>;
  /** Whether the changes since the page's `Last-Event-ID` may be sent instead of a whole state. */
  protected canResume: (missed: Entry[]) => boolean = () => true;
  /** A message on its way out, or null to leave it out. */
  protected filter(message: Message): Message | null {
    return message;
  }

  /** Runs `step` after every step before it, inside the event; a failure ends the stream. */
  enqueue(step: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(async () => {
      if (this.closed) return;
      try {
        await withTenant(this.tenant, step);
      } catch (err) {
        this.deps.log?.warn({ err, device_id: this.deviceId }, "push stream step failed");
        this.end();
      }
    });
    return this.chain;
  }

  start(onClose: () => void, lastEventId: string | undefined): Promise<void> {
    this.onClose.push(onClose);
    this.out.write("retry: 2000\n\n");
    this.timer = setInterval(
      () => void this.enqueue(() => this.ping()),
      this.deps.streamPingMs ?? PING_MS,
    );
    return this.enqueue(async () => {
      await this.place(lastEventId);
      await this.opened();
    });
  }

  /** The stream's zone may have changed (an assignment, a removal): a fresh `state`. */
  replace(): Promise<void> {
    return this.enqueue(() => this.place(undefined));
  }

  /** The event's context changed; the default looks again only at the next ping. */
  refresh(): Promise<void> {
    return Promise.resolve();
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.stopZone?.();
    this.out.end();
    for (const done of this.onClose) done();
  }

  protected write(raw: Message): void {
    if (this.closed) return;
    if (this.out.writableLength > MAX_BUFFERED_BYTES) {
      this.end();
      return;
    }
    const message = this.filter(raw);
    if (message === null) return;
    const id = this.zoneKey === null ? "none.0.0" : `${this.zoneKey}.${this.epoch}.${this.version}`;
    this.out.write(`event: ${message.event}\nid: ${id}\ndata: ${JSON.stringify(message.data)}\n\n`);
  }

  protected async place(lastEventId: string | undefined): Promise<void> {
    const placed = await this.locate();
    if (this.closed) return;
    if (placed.zoneKey !== this.zoneKey) {
      this.stopZone?.();
      const zone = placed.zoneKey;
      this.stopZone =
        zone === null
          ? undefined
          : this.deps.fanout.subscribe(keys.zoneChannel(zone), (raw) => {
              void this.enqueue(() => this.apply(JSON.parse(raw) as Entry));
            });
    }
    this.zoneKey = placed.zoneKey;
    this.orientation = placed.orientation;
    const record = placed.record;
    if (record !== null && placed.zoneKey !== null) {
      this.deps.onPlaced?.(this.tenant, placed.zoneKey, record.nextChangeAt ?? null);
    }
    const last = LAST_ID_RE.exec(lastEventId ?? "");
    if (
      record !== null &&
      last !== null &&
      last[1] === record.zone.key &&
      last[2] === record.zone.epoch
    ) {
      this.epoch = record.zone.epoch;
      this.version = Number(last[3]);
      const missed = await this.deps.zones.since(record.zone.key, this.version);
      if (missed !== null && this.canResume(missed)) {
        for (const entry of missed) await this.send(entry);
        await this.catchUp();
        return;
      }
    }
    this.epoch = record?.zone.epoch ?? "0";
    this.version = record?.version ?? 0;
    this.write({ event: "state", data: placed.state });
    // A change published between the build and the subscription above is caught here.
    await this.catchUp();
  }

  /** One change from the zone's channel, in order; a gap is filled from the log. */
  private async apply(entry: Entry): Promise<void> {
    if (this.zoneKey === null || entry.version <= this.version) return;
    if (entry.epoch !== this.epoch) {
      await this.place(undefined);
      return;
    }
    if (entry.version === this.version + 1) await this.send(entry);
    else await this.catchUp();
  }

  protected async catchUp(): Promise<void> {
    if (this.zoneKey === null) return;
    if ((await this.deps.zones.version(this.zoneKey)) <= this.version) return;
    const missed = await this.deps.zones.since(this.zoneKey, this.version);
    if (missed === null) {
      await this.sendState();
      return;
    }
    for (const entry of missed) await this.send(entry);
  }

  private async send(entry: Entry): Promise<void> {
    // A whole state sent for an earlier entry already holds this one.
    if (entry.version <= this.version) return;
    const messages = entry.messages[this.orientation];
    if (messages === null) {
      await this.sendState();
      return;
    }
    this.version = entry.version;
    for (const message of messages) this.write(message);
  }

  private async sendState(): Promise<void> {
    if (this.zoneKey === null) return;
    const record = await this.deps.zones.read(this.zoneKey);
    if (record === null) {
      await this.place(undefined);
      return;
    }
    this.epoch = record.zone.epoch;
    this.version = record.version;
    this.write({ event: "state", data: this.stateOf(record) });
  }
}
