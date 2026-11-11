/**
 * One open `GET /api/screen/device/stream` (contracts/screen.md, Push and Resume): the zone's
 * changes as every stream gets them (`feed.ts`), plus what is the device's own: `command`
 * messages, and a `ping` every 15 seconds that also checks the device again and counts it as seen.
 */
import { takeCommands } from "../assignments.js";
import { isPortrait } from "../compose/state.js";
import type { DeviceRow } from "../db.js";
import { checkDevice } from "../device-access.js";
import { recordSeen } from "../health.js";
import { assemble, placeDevice } from "./device-state.js";
import { Feed } from "./feed.js";
import type { FeedPlace, FeedRequest } from "./feed.js";
import { keys } from "./store.js";
import type { ZoneRecord } from "./store.js";

export { PING_MS } from "./feed.js";
export type { StreamDeps } from "./feed.js";

export interface StreamRequest extends FeedRequest {
  device: Pick<DeviceRow, "id" | "name">;
  token: string;
  ip: string;
  lastEventId: string | undefined;
}

export class DeviceStream extends Feed<StreamRequest> {
  private stopDevice: (() => void) | undefined;

  get deviceId(): string {
    return this.req.device.id;
  }

  override start(onClose: () => void): Promise<void> {
    this.stopDevice = this.deps.fanout.subscribe(keys.deviceChannel(this.deviceId), () => {
      void this.enqueue(() => this.deliverCommands());
    });
    return super.start(onClose, this.req.lastEventId);
  }

  override end(): void {
    this.stopDevice?.();
    super.end();
  }

  protected async locate(): Promise<FeedPlace> {
    const placed = await placeDevice(this.deps, this.req.ctx, this.req.host, this.req.device);
    this.mirror = placed.mirror;
    return placed;
  }

  protected stateOf(record: ZoneRecord): Record<string, unknown> {
    return assemble(record, this.orientation, {
      nowMs: (this.deps.now ?? Date.now)(),
      ctx: this.req.ctx,
      device: this.req.device,
      mirror: this.mirror,
      bundleVersion: this.deps.bundleVersion,
    });
  }

  protected async opened(): Promise<void> {
    await this.deliverCommands();
    await this.seen();
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
  override refresh(): Promise<void> {
    return this.enqueue(async () => {
      const { ok, changed } = await this.recheck((this.deps.now ?? Date.now)());
      if (ok && changed) await this.place(undefined);
    });
  }

  protected async ping(): Promise<void> {
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
