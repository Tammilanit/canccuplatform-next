/**
 * The arbiter (contracts/moments.md, The arbiter's rules): it starts, renews, refuses, narrows,
 * re-ranks and ends moments, and turns each change into the overrides Screen places. Every
 * method runs in the caller's tenant transaction, so a write and its events (the kit's Outbox)
 * commit together, and the tick (tick.ts) owns every TTL and patience from the stored times.
 */
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Outbox, SqlClient } from "@canccu/kit";
import { blockedOn, desiredOverrides, rankOn } from "./arbiter.js";
import type { Class, Orders } from "./arbiter.js";
import { reconcile } from "./reconcile.js";
import {
  heldOn,
  insertMoment,
  knownZones,
  loadOrders,
  happeningOwner,
  lockRunningByKey,
  saveMoment,
  titleOf,
  writeHistory,
  splitZones,
} from "./store.js";
import type { Actor, Binding, Kind, MomentRow, Origin, Qr, Source } from "./store.js";
import type { CueTrigger, Cues, ZoneOutcome } from "./cues/service.js";

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
  /** The cue its start plays: a picture on its box and a sound on its zones; an edit never does. */
  cue?: string | null;
  /** A storyboard round's steps (D9). */
  steps?: Record<string, unknown>[] | null;
  /** `type:source id` (WD1): refused while another live moment shows the same happening. */
  happening?: string | null;
  /** The story run that asks: its own live moments never count as another owner. */
  happening_run?: string | null;
  /** False: a rule's moment that waits its patience instead of being refused (a story's round). */
  refuse?: boolean;
  /** A story's round starts at its planned time, so its steps and an on-the-dot step land on it. */
  starts_at?: Date;
  /** Its planned end, to the millisecond (a story's round); else from `ttl_seconds`. */
  expires_at?: Date;
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
  constructor(
    readonly outbox: Outbox,
    private readonly cues?: Cues,
  ) {}

  /** A cue with no moment of its own (a new photo): its sound only. */
  async fireCue(c: SqlClient, t: CueTrigger, now: Date): Promise<ZoneOutcome[]> {
    return (await this.cues?.fire(c, t, now)) ?? [];
  }

  /** The cues, for a story's video sound and its skipped steps; undefined without sound. */
  get sound(): Cues | undefined {
    return this.cues;
  }

  /** The tick's turn for the sound queues (contracts/moments.md, Cues and sound). */
  async pumpSounds(c: SqlClient, now: Date): Promise<void> {
    await this.cues?.pumpAll(c, now);
  }

  /** A request: renews the running moment of its key (E4), is refused, or starts. */
  async request(c: SqlClient, r: MomentRequest, now: Date): Promise<RequestResult> {
    // As Postgres gives it back, so a re-post compares like with like (E4).
    r = { ...r, content: asJson(r.content) };
    const ttl = r.ttl_seconds === undefined ? DEFAULT_TTL_SECONDS : r.ttl_seconds;
    const key = r.dedupe_key ?? null;
    const running = key === null ? null : await lockRunningByKey(c, key);
    if (running !== null) {
      const same = running.template === r.template && isDeepStrictEqual(running.content, r.content);
      // A re-post extends and never shortens (contracts/moments.md, E4): the crew's Extend holds,
      // and a request without a TTL keeps the moment's own.
      const renewTtl = r.ttl_seconds === undefined ? running.ttl_seconds : r.ttl_seconds;
      if (renewTtl === null || running.expires_at === null) running.expires_at = null;
      else {
        const end = Math.max(running.expires_at.getTime(), now.getTime() + renewTtl * 1000);
        running.expires_at = new Date(end);
      }
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
    const refused = async (outcome: string, displaced: string, heldBy: string | null) => {
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
        outcome,
        displaced,
      });
      return {
        status: "refused" as const,
        retry_after_seconds: REFUSAL_RETRY_SECONDS,
        held_by: heldBy,
      };
    };
    const owner =
      r.happening == null ? null : await happeningOwner(c, r.happening, r.happening_run ?? null);
    if (owner !== null)
      return refused(
        "not started: one owner per happening",
        `${owner.title} already owns ${r.happening ?? ""}`,
        owner.id,
      );
    const orders = await loadOrders(c);
    const zones = await knownZones(c);
    if ((r.origin === "rule" || r.origin === "module") && r.refuse !== false) {
      const heldBy = await this.refusal(c, r.class, regions, r.zones ?? [], orders, zones);
      if (heldBy !== null)
        return refused(`refused, retry in ${REFUSAL_RETRY_SECONDS} s`, `held by ${heldBy}`, heldBy);
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
      starts_at: r.starts_at ?? now,
      expires_at: r.expires_at ?? (ttl === null ? null : new Date(now.getTime() + ttl * 1000)),
      ttl_seconds: ttl,
      patience_seconds:
        r.patience_seconds ??
        (people ? (ttl ?? FOREVER) : Math.min(RULE_PATIENCE_SECONDS, FOREVER)),
      qr: r.qr ?? null,
      binding: r.binding ?? null,
      effect: r.cue == null || this.cues === undefined ? null : await this.cues.picture(c, r.cue),
      steps: r.steps ?? null,
      happening: r.happening ?? null,
      ended_at: null,
      end_reason: null,
    };
    await insertMoment(c, moment);
    await this.history(c, moment, now, { action: "started", actor: r.actor ?? null });
    await reconcile(this.outbox, c, moment, r.actor ?? null, "cleared", orders, zones);
    if (r.cue != null) await this.cues?.started(c, moment, r.cue, now);
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
        await reconcile(this.outbox, c, m, actor, reason, orders, zones);
        return;
      }
    }
    m.ended_at = now;
    m.end_reason = reason;
    await saveMoment(c, m);
    await this.history(c, m, now, { action: "ended", outcome: reason, actor });
    await reconcile(this.outbox, c, m, actor, reason, await loadOrders(c), zones);
  }

  /** Shows a moment again as its row now says: content, end, rank and zones (E8). */
  async show(c: SqlClient, m: MomentRow, actor: Actor | null, reason: EndReason): Promise<void> {
    await reconcile(this.outbox, c, m, actor, reason, await loadOrders(c), await knownZones(c));
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
}

const asJson = (v: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
