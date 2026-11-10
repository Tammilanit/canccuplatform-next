/**
 * One open `GET /api/screen/device/stream` (contracts/screen.md, Push and Resume). Everything a
 * stream does runs one step at a time, in order, inside its event: the first state or the
 * resumed changes, the zone's changes as they are published, commands, and the `ping` every 15
 * seconds, which also checks the device again, counts it as seen and catches up on anything a
 * lost pub/sub message left out.
 */
import { PassThrough } from "node:stream";
import { withTenant } from "@canccu/kit";
import type { Bus, Logger, TenantContext } from "@canccu/kit";
import { takeCommands } from "../assignments.js";
import type { ComposeDeps } from "../compose/state.js";
import { isPortrait } from "../compose/state.js";
import type { DeviceRow } from "../db.js";
import { checkDevice } from "../device-access.js";
import { recordSeen } from "../health.js";
import { assemble, placeDevice } from "./device-state.js";
import { keys } from "./store.js";
import type { Entry, Fanout, Message, Orientation } from "./store.js";

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
}

export interface StreamRequest {
  /** As the connect resolved it; each `ping` resolves it again. */
  ctx: TenantContext;
  host: string;
  device: Pick<DeviceRow, "id" | "name">;
  token: string;
  ip: string;
  lastEventId: string | undefined;
}

export class DeviceStream {
  readonly out = new PassThrough();
  zoneKey: string | null = null;
  mirror = false;
  private epoch = "0";
  private version = 0;
  private orientation: Orientation = "landscape";
  private chain: Promise<void> = Promise.resolve();
  private closed = false;
  private stopZone: (() => void) | undefined;
  private stopDevice: (() => void) | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly onClose: (() => void)[] = [];

  constructor(
    private readonly deps: StreamDeps,
    readonly req: StreamRequest,
  ) {}

  get tenant(): string {
    return this.req.ctx.tenant_id;
  }
  get deviceId(): string {
    return this.req.device.id;
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

  start(onClose: () => void): Promise<void> {
    this.onClose.push(onClose);
    this.out.write("retry: 2000\n\n");
    this.stopDevice = this.deps.fanout.subscribe(keys.deviceChannel(this.deviceId), () => {
      void this.enqueue(() => this.deliverCommands());
    });
    this.timer = setInterval(
      () => void this.enqueue(() => this.ping()),
      this.deps.streamPingMs ?? PING_MS,
    );
    return this.enqueue(async () => {
      await this.place(this.req.lastEventId);
      await this.deliverCommands();
      await this.seen();
    });
  }

  /** The device's assignment or mirror target may have changed: a fresh `state`. */
  replace(): Promise<void> {
    return this.enqueue(() => this.place(undefined));
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.stopZone?.();
    this.stopDevice?.();
    this.out.end();
    for (const done of this.onClose) done();
  }

  private write(message: Message): void {
    if (this.closed) return;
    if (this.out.writableLength > MAX_BUFFERED_BYTES) {
      this.end();
      return;
    }
    const id = this.zoneKey === null ? "none.0.0" : `${this.zoneKey}.${this.epoch}.${this.version}`;
    this.out.write(`event: ${message.event}\nid: ${id}\ndata: ${JSON.stringify(message.data)}\n\n`);
  }

  private async place(lastEventId: string | undefined): Promise<void> {
    const placed = await placeDevice(this.deps, this.req.ctx, this.req.host, this.req.device);
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
    this.mirror = placed.mirror;
    this.orientation = placed.orientation;
    const record = placed.record;
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
      if (missed !== null) {
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

  private async catchUp(): Promise<void> {
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

  /** The zone's stored state as this device's `ScreenState`. */
  private async sendState(): Promise<void> {
    if (this.zoneKey === null) return;
    const record = await this.deps.zones.read(this.zoneKey);
    if (record === null) {
      await this.place(undefined);
      return;
    }
    this.epoch = record.zone.epoch;
    this.version = record.version;
    const state = assemble(record, this.orientation, {
      nowMs: (this.deps.now ?? Date.now)(),
      ctx: this.req.ctx,
      device: this.req.device,
      mirror: this.mirror,
      bundleVersion: this.deps.bundleVersion,
    });
    this.write({ event: "state", data: state });
  }

  private async deliverCommands(): Promise<void> {
    const nowMs = (this.deps.now ?? Date.now)();
    for (const c of await takeCommands(this.deps.kv, this.deviceId, nowMs)) {
      this.write({ event: "command", data: { command: c.command, expires_at: c.expires_at } });
    }
  }

  private async seen(): Promise<void> {
    const now = this.deps.now ?? Date.now;
    await recordSeen({ ...this.deps, now }, this.deviceId, now());
  }

  /**
   * The event and the device as they are now: the venue addresses, the emergency switch,
   * archiving, the time zone and the device's name. False when the stream has ended.
   */
  private async recheck(nowMs: number): Promise<{ ok: boolean; changed: boolean }> {
    const ctx = await this.deps.contextOf(this.req.host).catch(() => this.req.ctx);
    if (ctx?.tenant_id !== this.tenant) {
      this.end();
      return { ok: false, changed: false };
    }
    let match;
    try {
      match = await checkDevice(this.deps.db, ctx, this.req.token, this.req.ip, new Date(nowMs));
    } catch {
      // Revoked, moved or refused since it connected: the screen reconnects and gets the answer.
      this.end();
      return { ok: false, changed: false };
    }
    // A rename emits no event; the ping is where an open stream learns of it.
    const changed =
      ctx.status !== this.req.ctx.status ||
      ctx.time_zone !== this.req.ctx.time_zone ||
      match.device.name !== this.req.device.name;
    this.req.ctx = ctx;
    this.req.device = match.device;
    return { ok: true, changed };
  }

  /** After the event's status or venue check changed: refused screens go, the rest redraw. */
  refresh(): Promise<void> {
    return this.enqueue(async () => {
      const { ok, changed } = await this.recheck((this.deps.now ?? Date.now)());
      if (ok && changed) await this.place(undefined);
    });
  }

  private async ping(): Promise<void> {
    const nowMs = (this.deps.now ?? Date.now)();
    const { ok, changed } = await this.recheck(nowMs);
    if (!ok) return;
    this.write({ event: "ping", data: { time: new Date(nowMs).toISOString() } });
    await this.seen();
    // The first heartbeat, with the viewport, may come after the stream opened.
    const portrait = await isPortrait(this.deps.kv, this.deviceId, nowMs);
    if (changed || (portrait ? "portrait" : "landscape") !== this.orientation) {
      await this.place(undefined);
      return;
    }
    await this.catchUp();
    await this.deliverCommands();
  }
}
