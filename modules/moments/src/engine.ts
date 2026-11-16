/**
 * The arbiter (contracts/moments.md, The arbiter's rules): it starts, renews, refuses, narrows,
 * re-ranks and ends moments, and turns each change into the overrides Screen places. Every
 * method runs in the caller's tenant transaction, so a write and its events (the kit's Outbox)
 * commit together, and the tick (tick.ts) owns every TTL and patience from the stored times.
 */
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Outbox, SqlClient } from "@canccu/kit";
import { blockedOn, desiredOverrides, overrideChanges, rankOf, rankOn } from "./arbiter.js";
import type { Class, Orders, SentOverride, WantedOverride } from "./arbiter.js";
import {
  dropPlacements,
  endOverride,
  heldOn,
  insertMoment,
  knownZones,
  liveOverrides,
  loadOrders,
  lockRunningByKey,
  putOverride,
  saveMoment,
  titleOf,
  writeHistory,
  splitZones,
} from "./store.js";
import type { Actor, Binding, Kind, MomentRow, Origin, Qr, Source } from "./store.js";

export const DEFAULT_TTL_SECONDS = 120;
export const MAX_TTL_SECONDS = 7200;
export const REFUSAL_RETRY_SECONDS = 30;
/** A rule's moment waits this long for its first place on a zone (mockup 03: "waits 2 min"). */
export const RULE_PATIENCE_SECONDS = 120;
/** "Never gives up": people's moments and the emergency wait their whole life. */
const FOREVER = 2_147_483_647;

export type EndReason = "expired" | "cleared" | "preempted" | "source_ended";

export interface MomentRequest {
  class: Class;
  template: string;
  content: Record<string, unknown>;
  origin: Origin;
  why: string;
  kind?: Kind;
  zones?: string[];
  regions?: string[];
  /** Null: no end of its own (only the emergency). */
  ttl_seconds?: number | null;
  patience_seconds?: number;
  qr?: Qr | null;
  binding?: Binding | null;
  source?: Source;
  dedupe_key?: string | null;
  rule_id?: string | null;
  actor?: Actor | null;
}

export type RequestResult =
  | { status: "started" | "renewed"; moment: MomentRow }
  | { status: "refused"; retry_after_seconds: number; held_by: string | null };

/** Each class's default kind and region chain (contracts/moments.md, the classes' table). */
export const CLASS_DEFAULTS: Record<Class, { kind: Kind; regions: string[] }> = {
  emergency: { kind: "takeover", regions: ["full"] },
  stream: { kind: "takeover", regions: ["full"] },
  announcement: { kind: "block", regions: ["rail", "ticker"] },
  spotlight: { kind: "block", regions: ["hero"] },
  storyboard: { kind: "block", regions: ["hero"] },
  tournament: { kind: "block", regions: ["hero", "rail"] },
  finals: { kind: "block", regions: ["hero"] },
  hot_game: { kind: "block", regions: ["hero", "rail"] },
  reactions: { kind: "overlay", regions: ["overlay"] },
  ticker: { kind: "block", regions: ["ticker"] },
};

/** Whether `m` is on `zone` now: one it names (or a known zone, for every zone) it has not left. */
export function covers(
  m: Pick<MomentRow, "zones" | "left_zones">,
  zone: string,
  known: readonly string[],
): boolean {
  if (m.left_zones.includes(zone)) return false;
  return m.zones.length === 0 ? known.includes(zone) : m.zones.includes(zone);
}

export class Engine {
  /** Scenes send their own events through it, in the same transactions (scene-store.ts). */
  constructor(readonly outbox: Outbox) {}

  /** A request: renews the running moment of its key (E4), is refused, or starts. */
  async request(c: SqlClient, r: MomentRequest, now: Date): Promise<RequestResult> {
    // As Postgres gives it back, so a re-post compares like with like (E4).
    r = { ...r, content: asJson(r.content) };
    const ttl = r.ttl_seconds === undefined ? DEFAULT_TTL_SECONDS : r.ttl_seconds;
    const key = r.dedupe_key ?? null;
    const running = key === null ? null : await lockRunningByKey(c, key);
    if (running !== null) {
      const same = running.template === r.template && isDeepStrictEqual(running.content, r.content);
      running.expires_at = ttl === null ? null : new Date(now.getTime() + ttl * 1000);
      if (!same) {
        running.template = r.template;
        running.content = r.content;
        await this.history(c, running, now, { action: "changed", actor: r.actor ?? null });
      }
      await saveMoment(c, running);
      await this.show(c, running, r.actor ?? null, "cleared");
      return { status: "renewed", moment: running };
    }
    const defaults = CLASS_DEFAULTS[r.class];
    const regions = r.regions ?? defaults.regions;
    const orders = await loadOrders(c);
    const zones = await knownZones(c);
    if (r.origin === "rule" || r.origin === "module") {
      const heldBy = await this.refusal(c, r.class, regions, r.zones ?? [], orders, zones);
      if (heldBy !== null) {
        await writeHistory(c, {
          at: now,
          zone_key: null,
          action: "refused",
          moment_id: null,
          class: r.class,
          origin: r.origin,
          title: titleOf(r),
          region: regions[0] ?? null,
          why: r.why,
          outcome: `refused, retry in ${REFUSAL_RETRY_SECONDS} s`,
          displaced: `held by ${heldBy}`,
        });
        return { status: "refused", retry_after_seconds: REFUSAL_RETRY_SECONDS, held_by: heldBy };
      }
    }
    const people = r.origin === "crew" || r.origin === "emergency";
    const moment: MomentRow = {
      id: `mo_${randomUUID()}`,
      class: r.class,
      kind: r.kind ?? defaults.kind,
      regions,
      template: r.template,
      content: r.content,
      zones: r.zones ?? [],
      left_zones: [],
      origin: r.origin,
      rule_id: r.rule_id ?? null,
      source: r.source ?? { module: "moments", event_id: null, ref: null },
      why: r.why,
      actor_user_id: r.actor?.user_id ?? null,
      actor_name: r.actor?.name ?? null,
      dedupe_key: key,
      starts_at: now,
      expires_at: ttl === null ? null : new Date(now.getTime() + ttl * 1000),
      ttl_seconds: ttl,
      patience_seconds:
        r.patience_seconds ??
        (people ? (ttl ?? FOREVER) : Math.min(RULE_PATIENCE_SECONDS, FOREVER)),
      qr: r.qr ?? null,
      binding: r.binding ?? null,
      ended_at: null,
      end_reason: null,
    };
    await insertMoment(c, moment);
    await this.history(c, moment, now, { action: "started", actor: r.actor ?? null });
    await this.reconcile(c, moment, r.actor ?? null, "cleared", orders, zones);
    return { status: "started", moment };
  }

  /** New content for a running moment (a live binding, E4): `.changed` with the content. */
  async setContent(
    c: SqlClient,
    m: MomentRow,
    content: Record<string, unknown>,
    now: Date,
  ): Promise<void> {
    const next = asJson(content);
    if (isDeepStrictEqual(m.content, next)) return;
    m.content = next;
    await saveMoment(c, m);
    await this.history(c, m, now, { action: "changed", actor: null });
    await this.show(c, m, null, "cleared");
  }

  /** Moves the end on by `seconds`, at most the longest TTL after now. */
  async extend(c: SqlClient, m: MomentRow, seconds: number, actor: Actor, now: Date) {
    const from = Math.max(m.expires_at?.getTime() ?? now.getTime(), now.getTime());
    m.expires_at = new Date(
      Math.min(from + seconds * 1000, now.getTime() + MAX_TTL_SECONDS * 1000),
    );
    await saveMoment(c, m);
    await this.show(c, m, actor, "cleared");
  }

  /** Ends a moment everywhere, or on one zone only (it then stays on the rest, D3). */
  async end(
    c: SqlClient,
    m: MomentRow,
    reason: EndReason,
    actor: Actor | null,
    now: Date,
    zone?: string,
  ): Promise<void> {
    if (m.ended_at !== null) return;
    const zones = await knownZones(c);
    if (zone !== undefined) {
      // A zone it never covered would narrow it for nothing: one of every zone to the rest.
      if (!covers(m, zone, zones)) return;
      m.left_zones = [...m.left_zones, zone];
      const orders = await loadOrders(c);
      const split = await splitZones(c, m.id);
      if (desiredOverrides(m, orders, zones, split).length > 0) {
        await saveMoment(c, m);
        await this.history(c, m, now, { action: "ended", zone, outcome: reason, actor });
        await this.reconcile(c, m, actor, reason, orders, zones);
        return;
      }
    }
    m.ended_at = now;
    m.end_reason = reason;
    await saveMoment(c, m);
    await this.history(c, m, now, { action: "ended", outcome: reason, actor });
    await this.reconcile(c, m, actor, reason, await loadOrders(c), zones);
  }

  /** Shows a moment again as its row now says: content, end, rank and zones (E8). */
  async show(c: SqlClient, m: MomentRow, actor: Actor | null, reason: EndReason): Promise<void> {
    await this.reconcile(c, m, actor, reason, await loadOrders(c), await knownZones(c));
  }

  /** Who holds every region the request may take on every zone it names, or null. */
  private async refusal(
    c: SqlClient,
    cls: Class,
    regions: string[],
    wanted: string[],
    orders: Orders,
    known: string[],
  ): Promise<string | null> {
    const zones = wanted.length > 0 ? wanted : known;
    if (zones.length === 0) return null;
    const held = await heldOn(c, zones);
    let top: { rank: number; id: string } | null = null;
    for (const zone of zones) {
      const here = held.filter((h) => h.zone === zone);
      if (!blockedOn(regions, rankOn(orders, zone, cls), here)) return null;
      for (const h of here)
        if (top === null || h.rank > top.rank) top = { rank: h.rank, id: h.override_id };
    }
    if (top === null) return null;
    const { rows } = await c.query(
      `SELECT m.content, m.template FROM moment_overrides o
       JOIN moments m ON m.tenant_id = o.tenant_id AND m.id = o.moment_id
       WHERE o.override_id = $1`,
      [top.id],
    );
    const row = rows[0] as Pick<MomentRow, "content" | "template"> | undefined;
    return `${row === undefined ? top.id : titleOf(row)} (rank ${top.rank})`;
  }

  /**
   * Sends what changed between the overrides last sent and the ones the moment wants now:
   * `.started` for new ones first (so a zone moved to its own override has no gap), then
   * `.changed`, a narrowing's `.ended` with `final: false`, and `.ended` for the ones it no
   * longer wants (contracts/moments.md, The overrides it emits).
   */
  private async reconcile(
    c: SqlClient,
    m: MomentRow,
    actor: Actor | null,
    reason: EndReason,
    orders: Orders,
    known: string[],
  ): Promise<void> {
    const stored = new Map((await liveOverrides(c, m.id)).map((s) => [s.override_id, s.sent]));
    const wanted =
      m.ended_at === null ? desiredOverrides(m, orders, known, await splitZones(c, m.id)) : [];
    const by = actor?.user_id ?? null;
    for (const w of wanted.filter((w) => !stored.has(w.id))) {
      const next = sentOf(m, w);
      await putOverride(c, m.id, next);
      await this.emit(c, "moments.override.started", {
        override: wire(m, next),
        actor_user_id: by,
      });
    }
    for (const w of wanted.filter((w) => stored.has(w.id))) {
      const before = stored.get(w.id) as SentOverride;
      const next = sentOf(m, w);
      const changed = overrideChanges(before, next);
      if (changed.length === 0) continue;
      await putOverride(c, m.id, next);
      await this.emit(c, "moments.override.changed", {
        override: wire(m, next),
        changed,
        actor_user_id: by,
      });
      const left = (before.zones.length === 0 ? known : before.zones).filter(
        (z) => !next.zones.includes(z),
      );
      if (next.zones.length > 0 && left.length > 0) {
        await dropPlacements(c, w.id, left);
        await this.emit(c, "moments.override.ended", {
          override_id: w.id,
          zones: left,
          reason,
          final: false,
          actor_user_id: by,
        });
      }
    }
    for (const [id, sent] of stored) {
      if (wanted.some((w) => w.id === id)) continue;
      await endOverride(c, id);
      await this.emit(c, "moments.override.ended", {
        override_id: id,
        zones: sent.zones,
        reason,
        final: true,
        actor_user_id: by,
      });
    }
  }

  async history(
    c: SqlClient,
    m: MomentRow,
    at: Date,
    e: {
      action: "started" | "changed" | "ended";
      zone?: string;
      outcome?: string;
      actor: Actor | null;
    },
  ): Promise<void> {
    await writeHistory(c, {
      at,
      zone_key: e.zone ?? null,
      action: e.action,
      moment_id: m.id,
      class: m.class,
      origin: m.origin,
      title: titleOf(m),
      region: e.action === "started" ? (m.regions[0] ?? null) : null,
      why: m.why,
      outcome: e.outcome ?? null,
      actor: e.actor,
    });
  }

  private async emit(c: SqlClient, type: string, data: Record<string, unknown>): Promise<void> {
    await this.outbox.add(c, type, data, { version: 1 });
  }
}

const asJson = (v: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(v)) as Record<string, unknown>;

function sentOf(m: MomentRow, w: WantedOverride): SentOverride {
  return {
    id: w.id,
    kind: m.kind,
    zones: w.zones,
    rank: w.rank,
    template: m.template,
    content: m.content,
    regions: m.regions,
    expires_at: m.expires_at?.toISOString() ?? null,
  };
}

/** The Override as the events carry it (events.md, Screen overrides; screen.md, claims). */
function wire(m: MomentRow, s: SentOverride): Record<string, unknown> {
  return {
    ...s,
    source: m.source,
    sound: null,
    steps: null,
    on_end: "resume",
    starts_at: m.starts_at.toISOString(),
    ends_at: m.ended_at?.toISOString() ?? null,
  };
}

/** The rank a moment has in the event's order, as the API shows it. */
export function eventRank(orders: Orders, cls: Class): number {
  return rankOf(orders.order, cls);
}
