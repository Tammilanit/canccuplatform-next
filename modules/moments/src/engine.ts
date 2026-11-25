/**
 * The arbiter (contracts/moments.md, The arbiter's rules): it starts, renews, refuses, narrows,
 * re-ranks and ends moments, and turns each change into the overrides Screen places. Every
 * method runs in the caller's tenant transaction, so a write and its events (the kit's Outbox)
 * commit together, and the tick (tick.ts) owns every TTL and patience from the stored times.
 */
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Outbox, SqlClient } from "@canccu/kit";
import type { Class } from "./arbiter.js";
import { passZone, withdraw, withdrawAll } from "./air.js";
import { saveSlot, slotsOf } from "./air-store.js";
import { reconcile } from "./reconcile.js";
import {
  insertMoment,
  knownZones,
  loadOrders,
  happeningOwner,
  lockRunningByKey,
  saveMoment,
  titleOf,
  writeHistory,
} from "./store.js";
import type { Actor, Binding, Kind, MomentRow, Origin, Qr, Source } from "./store.js";
import type { CueTrigger, Cues, ZoneOutcome } from "./cues/service.js";
import { playedAt } from "./air-store.js";

export const DEFAULT_TTL_SECONDS = 120;
export const MAX_TTL_SECONDS = 7200;
/** The only refusal left is one owner per happening (WD1); its answer still names a retry. */
export const REFUSAL_RETRY_SECONDS = 30;

/** Each as `moments.override.ended` carries it (contracts/events.md). */
export const END_REASONS = ["expired", "cleared", "preempted", "source_ended", "stale"] as const;
export type EndReason = (typeof END_REASONS)[number];

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
  /** Deprecated (#777): may shorten its class's `stale_after`, never lengthen it. */
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
  /** A story's round starts at its planned time, so its steps and an on-the-dot step land on it. */
  starts_at?: Date;
  /** The start of what it is about (its run-of-show item): its cue's window measures from it. */
  source_starts_at?: Date;
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
      // An update replaces the queued or shown one (rule 5, E4): new content is fresh news again,
      // its queue place stays, and its on-air time never shortens.
      const same =
        running.template === r.template &&
        isDeepStrictEqual(running.content, r.content) &&
        (r.steps === undefined || isDeepStrictEqual(running.steps, r.steps));
      const renewTtl = r.ttl_seconds === undefined ? running.ttl_seconds : r.ttl_seconds;
      for (const slot of await slotsOf(c, running.id)) {
        if (renewTtl === null || slot.budget_ms === null) slot.budget_ms = null;
        else slot.budget_ms = Math.max(slot.budget_ms, playedAt(slot, now) + renewTtl * 1000);
        await saveSlot(c, slot);
      }
      if (!same) {
        running.template = r.template;
        running.content = r.content;
        if (r.steps !== undefined) running.steps = r.steps;
        running.fresh_at = now;
        await this.history(c, running, now, { action: "changed", actor: r.actor ?? null });
      }
      await saveMoment(c, running);
      await this.show(c, running, r.actor ?? null, "cleared", now);
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
    const { air } = await loadOrders(c);
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
      patience_seconds: Math.min(
        air.stale_after_ms[r.class] / 1000,
        r.patience_seconds ?? Number.POSITIVE_INFINITY,
      ),
      qr: r.qr ?? null,
      binding: r.binding ?? null,
      effect: r.cue == null || this.cues === undefined ? null : await this.cues.picture(c, r.cue),
      steps: r.steps ?? null,
      happening: r.happening ?? null,
      fresh_at: null,
      planned_ms:
        r.expires_at === undefined ? null : r.expires_at.getTime() - (r.starts_at ?? now).getTime(),
      ended_at: null,
      end_reason: null,
    };
    await insertMoment(c, moment);
    await this.history(c, moment, now, { action: "started", actor: r.actor ?? null });
    await this.show(c, moment, r.actor ?? null, "cleared", now);
    if (r.cue != null) await this.cues?.started(c, moment, r.cue, now, r.source_starts_at ?? null);
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
    await this.show(c, m, null, "cleared", now);
  }

  /** Adds `seconds` of on-air time on each zone, at most 7200 s from now. */
  async extend(c: SqlClient, m: MomentRow, seconds: number, actor: Actor, now: Date) {
    for (const slot of await slotsOf(c, m.id)) {
      if (slot.budget_ms === null) continue;
      const played = playedAt(slot, now);
      const left = Math.min(slot.budget_ms - played + seconds * 1000, MAX_TTL_SECONDS * 1000);
      slot.budget_ms = played + left;
      await saveSlot(c, slot);
    }
    await this.show(c, m, actor, "cleared", now);
    const { rows } = await c.query(`SELECT expires_at FROM moments WHERE id = $1`, [m.id]);
    m.expires_at = (rows[0]?.expires_at as Date | null | undefined) ?? m.expires_at;
  }

  /** Its remaining on-air time on each zone becomes the time until `at` (a story's paused video). */
  async endsBy(c: SqlClient, m: MomentRow, at: Date, now: Date): Promise<void> {
    for (const slot of await slotsOf(c, m.id)) {
      slot.budget_ms = playedAt(slot, now) + Math.max(0, at.getTime() - now.getTime());
      await saveSlot(c, slot);
    }
    await this.show(c, m, null, "cleared", now);
  }

  /** Moves a waiting moment to the front of a zone's queue (rule 7); false when it is not waiting there. */
  async forward(
    c: SqlClient,
    m: MomentRow,
    zone: string,
    actor: Actor,
    now: Date,
  ): Promise<boolean> {
    const slot = (await slotsOf(c, m.id)).find((s) => s.zone_key === zone);
    if (slot === undefined || slot.granted === "hero" || slot.granted === "pass") return false;
    slot.forward_at = now;
    await saveSlot(c, slot);
    await this.history(c, m, now, { action: "moved", zone, actor });
    await passZone(c, this, zone, now, "wait", actor);
    return true;
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
    await this.ending(c, m, reason, actor, now, zone, true);
  }

  /** An end on one zone from inside that zone's pass (air.ts), which plans the zone again itself. */
  async endHere(c: SqlClient, m: MomentRow, reason: EndReason, now: Date, zone: string) {
    await this.ending(c, m, reason, null, now, zone, false);
  }

  private async ending(
    c: SqlClient,
    m: MomentRow,
    reason: EndReason,
    actor: Actor | null,
    now: Date,
    zone: string | undefined,
    pass: boolean,
  ): Promise<void> {
    if (m.ended_at !== null) return;
    const zones = await knownZones(c);
    if (zone !== undefined) {
      // A zone it never covered would narrow it for nothing: one of every zone to the rest.
      if (!covers(m, zone, zones)) return;
      m.left_zones = [...m.left_zones, zone];
      if (zones.some((z) => covers(m, z, zones))) {
        await saveMoment(c, m);
        await this.history(c, m, now, { action: "ended", zone, outcome: reason, actor });
        if (m.class === "emergency") {
          await reconcile(this.outbox, c, m, actor, reason, await loadOrders(c), zones);
          return;
        }
        const slot = (await slotsOf(c, m.id)).find((s) => s.zone_key === zone);
        if (slot !== undefined) await withdraw(c, this.outbox, slot, reason, actor, true);
        if (pass) await passZone(c, this, zone, now, "wait", actor, reason);
        return;
      }
    }
    m.ended_at = now;
    m.end_reason = reason;
    await saveMoment(c, m);
    // The zone it ended on, when a zone's pass ended it: On air's stale list reads it.
    await this.history(c, m, now, {
      action: "ended",
      ...(zone === undefined ? {} : { zone }),
      outcome: reason,
      actor,
    });
    if (m.class === "emergency") {
      await reconcile(this.outbox, c, m, actor, reason, await loadOrders(c), zones);
      return;
    }
    const held = await withdrawAll(c, this.outbox, m, reason, actor);
    if (pass) for (const z of held) await passZone(c, this, z, now, "wait", actor, reason);
  }

  /** Shows a moment again as its row now says (E8): the emergency by its override, the rest by each zone's pass. */
  async show(
    c: SqlClient,
    m: MomentRow,
    actor: Actor | null,
    reason: EndReason,
    now: Date,
  ): Promise<void> {
    const zones = await knownZones(c);
    if (m.class === "emergency") {
      await reconcile(this.outbox, c, m, actor, reason, await loadOrders(c), zones);
      return;
    }
    for (const z of zones.filter((z) => covers(m, z, zones)))
      await passZone(c, this, z, now, "wait", actor, reason, m.id);
  }

  async history(
    c: SqlClient,
    m: MomentRow,
    at: Date,
    e: {
      action: "started" | "changed" | "ended" | "moved";
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
