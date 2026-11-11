/**
 * A zone for a signed-in person (contracts/screen.md, A zone for a session): the zone's state
 * and push messages as a mirror of the zone gets them, for the admin's virtual screen, Studio's
 * live view and its previews. These pages leave the venue on laptops and phones, so the
 * `checkin_qr` widget never carries its live code there: its code proves presence at the venue
 * only while it stays on the venue's screens.
 */
import { checkAdminAccess } from "@canccu/kit";
import type { RightsChecker, TenantContext } from "@canccu/kit";
import type { RegionView } from "../compose/build.js";
import { assemble, refreshZone } from "./device-state.js";
import { Feed } from "./feed.js";
import type { FeedPlace, FeedRequest, StreamDeps } from "./feed.js";
import type { Entry, Message, Orientation, ZoneRecord } from "./store.js";

export const SESSION_RIGHT = "screen.devices.read";

/** The view-model's fields that carry or date the code (contracts/screen.md, Widgets). */
/** Events that carry no widget view, so no check-in code: passed to a person unchanged. */
const PASSED_AS_IS = new Set(["theme", "ticker", "ping"]);
const CODE_FIELDS = ["url", "image_url", "rotates_at", "valid_until", "qr"];

/** A `checkin_qr` view as a sample: its label and purpose, no code. */
function sampleView(view: Record<string, unknown>): Record<string, unknown> {
  const out = { ...view };
  for (const field of CODE_FIELDS) out[field] = null;
  return out;
}

function sampleRegion(region: RegionView): RegionView {
  if (!region.widgets.some((w) => w.widget === "checkin_qr")) return region;
  return {
    ...region,
    widgets: region.widgets.map((w) =>
      w.widget === "checkin_qr" ? { ...w, view: sampleView(w.view) as typeof w.view } : w,
    ),
  };
}

export function sampleRegions(regions: readonly RegionView[]): RegionView[] {
  return regions.map(sampleRegion);
}

export interface Viewer {
  /** `mirror` for a zone's live view, `preview` for an unsaved zone. */
  id: "mirror" | "preview";
  nowMs: number;
  ctx: TenantContext;
  bundleVersion: string;
}

/** The zone's `ScreenState` for a person: a mirror's, never sounding, with no check-in code. */
export function viewerState(
  record: ZoneRecord,
  orientation: Orientation,
  viewer: Viewer,
): Record<string, unknown> {
  const state = assemble(record, orientation, {
    nowMs: viewer.nowMs,
    ctx: viewer.ctx,
    device: { id: viewer.id, name: record.zone.name },
    mirror: true,
    bundleVersion: viewer.bundleVersion,
  });
  return { ...state, regions: sampleRegions(state.regions as RegionView[]) };
}

export interface SessionDeps extends StreamDeps {
  rights: RightsChecker;
}

export interface SessionRequest extends FeedRequest {
  zone: string;
  orientation: Orientation;
  cookie: string;
  ip: string;
}

/** One open `GET /api/screen/zones/{zone_key}/stream`: no commands, no heartbeat, no health. */
export class SessionStream extends Feed<SessionRequest> {
  /** The widget types of each region as last sent, so a `widget` message is known by its index. */
  private readonly types = new Map<string, string[]>();

  constructor(
    private readonly session: SessionDeps,
    req: SessionRequest,
    private readonly onPing: () => Promise<void> = () => Promise.resolve(),
  ) {
    super(session, req);
  }

  get deviceId(): null {
    return null;
  }

  protected async locate(): Promise<FeedPlace> {
    const record = await refreshZone(this.deps, this.req.ctx, this.req.host, this.req.zone);
    if (record === null) {
      // The zone is gone: the page's next connect is 404.
      this.end();
      return { zoneKey: null, orientation: this.req.orientation, record: null, state: {} };
    }
    this.remember(record.views[this.req.orientation].regions);
    return {
      zoneKey: this.req.zone,
      orientation: this.req.orientation,
      record,
      state: this.stateOf(record),
    };
  }

  protected stateOf(record: ZoneRecord): Record<string, unknown> {
    return viewerState(record, this.req.orientation, {
      id: "mirror",
      nowMs: (this.deps.now ?? Date.now)(),
      ctx: this.req.ctx,
      bundleVersion: this.deps.bundleVersion,
    });
  }

  /**
   * Resume only over changes that keep every region's widgets: the types are known from the
   * current record alone, and a `widget` message of an older layout could otherwise be taken for
   * another type and carry a check-in code out. Anything else gets a whole state.
   */
  protected override canResume = (missed: Entry[]): boolean =>
    missed.every((e) => {
      const messages = e.messages[this.req.orientation];
      return messages !== null && messages.every((m) => m.event !== "region");
    });

  protected opened(): Promise<void> {
    return Promise.resolve();
  }

  protected override filter(message: Message): Message | null {
    const data = message.data;
    if (message.event === "state") {
      this.types.clear();
      this.remember(data.regions as RegionView[]);
      return message;
    }
    if (message.event === "region") {
      const region = sampleRegion(data.region as RegionView);
      this.remember([region]);
      return { event: "region", data: { ...data, region } };
    }
    if (message.event === "widget") {
      const type = this.types.get(data.region_id as string)?.[data.index as number];
      // A region it never saw: leave it out rather than guess (fails closed).
      if (type === undefined) return null;
      if (type !== "checkin_qr") return message;
      return {
        event: "widget",
        data: { ...data, view: sampleView(data.view as Record<string, unknown>) },
      };
    }
    // An allowlist (fails closed): an event added later that carries widget views stays off a
    // person's stream until it is sampled here. Never a device's commands: a person is no device.
    return PASSED_AS_IS.has(message.event) ? message : null;
  }

  private remember(regions: readonly RegionView[]): void {
    for (const r of regions) {
      this.types.set(
        r.id,
        r.widgets.map((w) => w.widget),
      );
    }
  }

  /** The session and the right as they are now, and the admin pages' address rule; else it ends. */
  protected async ping(): Promise<void> {
    const nowMs = (this.deps.now ?? Date.now)();
    const ctx = await this.deps.contextOf(this.req.host).catch(() => null);
    if (ctx?.tenant_id !== this.tenant || !(await this.allowed(ctx))) {
      this.end();
      return;
    }
    this.req.ctx = ctx;
    await this.onPing();
    this.write({ event: "ping", data: { time: new Date(nowMs).toISOString() } });
    await this.catchUp();
  }

  private async allowed(ctx: TenantContext): Promise<boolean> {
    try {
      checkAdminAccess(ctx, this.req.ip);
      const session = await this.session.rights.session(this.req.cookie);
      return (
        session.rights.has(SESSION_RIGHT) &&
        session.expiresAt.getTime() > (this.deps.now ?? Date.now)()
      );
    } catch {
      // Admin unreachable counts too: a view nobody can vouch for ends, and the page reconnects.
      return false;
    }
  }
}
