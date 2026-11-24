/**
 * The engine's airtime pass (contracts/moments.md, The arbiter's rules; #777): for one zone,
 * under its hero row's lock, it reads the moments on the zone and their slots, runs the pure
 * scheduler (air-plan.ts), ends what it says ends, keeps each clock, and sends each moment's
 * override for that zone (`<id>.<zone>`, then `.2`, … after it was held back) as the plan wants
 * it. Every write and event goes in the caller's transaction (the kit's Outbox).
 */
import { isDeepStrictEqual } from "node:util";
import type { Outbox, SqlClient } from "@canccu/kit";
import { planZone } from "./air-plan.js";
import type { SlotIn, SlotOut } from "./air-plan.js";
import type { AirSettings } from "./air-settings.js";
import {
  dropSlot,
  lockZone,
  newSlot,
  pause,
  playedAt,
  resume,
  saveSlot,
  saveZone,
  slotsOf,
  slotsOn,
  syncExpiry,
} from "./air-store.js";
import type { SlotRow } from "./air-store.js";
import { overrideChanges, rankOn } from "./arbiter.js";
import type { SentOverride } from "./arbiter.js";
import { endOverride, liveOverrides, loadOrders, putOverride } from "./store.js";
import type { Actor, MomentRow } from "./store.js";
import type { EndReason } from "./engine.js";

/** What a pass needs of the engine: its outbox, and an end on one zone that runs no pass. */
export interface PassEngine {
  outbox: Outbox;
  endHere(c: SqlClient, m: MomentRow, reason: EndReason, now: Date, zone: string): Promise<void>;
}

const STEP_MIN_MS = 8000;
const STEP_MAX_MS = 60_000;

const onAir = (g: SlotRow["granted"]) => g === "hero" || g === "pass";

/** The running moments on `zone` that the scheduler places (every one but the emergency). */
async function momentsOn(c: SqlClient, zone: string): Promise<MomentRow[]> {
  const { rows } = await c.query(
    `SELECT * FROM moments WHERE ended_at IS NULL AND class <> 'emergency'
       AND (cardinality(zones) = 0 OR $1 = ANY (zones)) AND NOT ($1 = ANY (left_zones))
     ORDER BY starts_at, id`,
    [zone],
  );
  return rows as unknown as MomentRow[];
}

/**
 * Its on-air time on a new zone: a story round's planned length, else its TTL. Never from
 * `expires_at`, which `syncExpiry` moves to the stale time while it waits on another zone.
 */
const budgetOf = (m: MomentRow): number | null =>
  m.planned_ms !== null
    ? Math.max(1000, m.planned_ms)
    : m.ttl_seconds === null
      ? null
      : m.ttl_seconds * 1000;

/** When it goes stale: its class's time after it was fresh news, shortened by its own patience. */
export function staleAt(m: MomentRow, air: AirSettings): number {
  const fresh = (m.fresh_at ?? m.starts_at).getTime();
  return fresh + Math.min(air.stale_after_ms[m.class], m.patience_seconds * 1000);
}

/** A story round's segment from its key, `story:<run>:<round>:<f?><segment>` (story/round.ts). */
function segmentOf(m: MomentRow): SlotIn["segment"] {
  const k =
    m.rule_id?.startsWith("story:") === true
      ? /^(story:.+:f?)(\d+)$/.exec(m.dedupe_key ?? "")
      : null;
  return k === null ? null : { round: k[1] as string, index: Number(k[2]) };
}

function slotIn(s: SlotRow, m: MomentRow, rank: number, air: AirSettings): SlotIn {
  return {
    moment_id: m.id,
    class: m.class,
    rank,
    chain: m.regions,
    origin: m.origin,
    rule_id: m.rule_id,
    segment: segmentOf(m),
    has_steps: m.steps !== null,
    shown: s.generation > 0,
    // The planner counts stale from `fresh_at` with the class's time; a shorter own patience moves it.
    fresh_at: staleAt(m, air) - air.stale_after_ms[m.class],
    queued_since: s.queued_since.getTime(),
    forward_at: s.forward_at?.getTime() ?? null,
    granted: s.granted,
    inside_of: s.inside_of,
    on_air_since: s.on_air_since?.getTime() ?? null,
    played_ms: s.played_ms,
    tenure_from_ms: s.tenure_from_ms,
    budget_ms: s.budget_ms,
  };
}

/** Runs the scheduler on `zone` and sends what changed. `skip`: the tick, which leaves a held zone. */
export async function passZone(
  c: SqlClient,
  engine: PassEngine,
  zone: string,
  now: Date,
  lock: "wait" | "skip" = "wait",
  actor: Actor | null = null,
  reason: EndReason = "cleared",
  requested: string | null = null,
): Promise<void> {
  let z0 = await lockZone(c, zone, lock);
  if (z0 === null) return;
  const { air, ...orders } = await loadOrders(c);
  // Ends change who is live, so the plan is made again after them; each round ends at least one.
  // A slot made in any round of this pass is new: it shows from its moment's own start.
  const fresh = new Set<string>();
  const own = new Set<string>();
  for (let round = 0; round < 50; round += 1) {
    const moments = new Map((await momentsOn(c, zone)).map((m) => [m.id, m]));
    const slots = new Map<string, SlotRow>();
    for (const s of await slotsOn(c, zone)) {
      if (moments.has(s.moment_id)) slots.set(s.moment_id, s);
      else await withdraw(c, engine.outbox, s, reason, actor, true);
    }
    for (const m of moments.values())
      if (!slots.has(m.id)) {
        slots.set(m.id, await newSlot(c, m.id, zone, m.starts_at, budgetOf(m)));
        fresh.add(m.id);
        // Only a moment asked for in this very pass (or one that starts later) runs from its own
        // start; one reaching a zone late gets its full time there (rule 2).
        if (m.id === requested || m.starts_at.getTime() > now.getTime()) own.add(m.id);
      }
    const ins = [...slots.values()].map((s) => {
      const m = moments.get(s.moment_id) as MomentRow;
      return slotIn(s, m, rankOn(orders, zone, m.class), air);
    });
    const plan = planZone(now.getTime(), z0, ins, air);
    if (plan.ends.length > 0) {
      // As the plan has it: the gap from when the holder's time ran out, or its next segment.
      z0 = plan.zone;
      for (const e of plan.ends) {
        const m = moments.get(e.moment_id);
        if (m !== undefined) await engine.endHere(c, m, e.reason, now, zone);
      }
      continue;
    }
    for (const out of plan.slots) {
      const s = slots.get(out.moment_id) as SlotRow;
      const m = moments.get(out.moment_id) as MomentRow;
      const steps = condensedSteps(plan.slots, out, moments, air);
      if (plan.condensed?.holder === m.id && steps !== null)
        s.budget_ms = steps.reduce((t, x) => t + (x.duration_ms as number), 0);
      apply(s, out, m, air, now, own.has(m.id) ? m.starts_at : now);
      await send(
        c,
        engine.outbox,
        m,
        s,
        out,
        rankOn(orders, zone, m.class),
        steps,
        // Shown in the pass that asked for it: from its own start, so a story's late take plays
        // from the item's time (SU3); else from now, minus what it already played (rule 2).
        own.has(m.id) ? m.starts_at : new Date(now.getTime() - playedAt(s, now)),
        actor,
        reason,
      );
      await saveSlot(c, s);
      await syncExpiry(c, m.id);
    }
    await saveZone(c, zone, plan.zone);
    return;
  }
}

/** The slot's clock and place as the plan has them (D5: the clock runs from the grant). */
/** `from`: when its clock starts if it goes on air now; a new moment's own start (a story's plan). */
function apply(
  s: SlotRow,
  out: SlotOut,
  m: MomentRow,
  air: AirSettings,
  now: Date,
  from: Date,
): void {
  const was = onAir(s.granted);
  const is = onAir(out.granted);
  if (was && !is) pause(s, now);
  if (!was && is) resume(s, from);
  s.granted = out.granted;
  s.inside_of = out.inside_of;
  s.queued_since = new Date(out.queued_since);
  s.tenure_from_ms = out.tenure_from_ms;
  const running = is && s.on_air_since !== null;
  s.ends_at = !running
    ? new Date(staleAt(m, air))
    : s.budget_ms === null
      ? null
      : new Date((s.on_air_since as Date).getTime() + s.budget_ms - s.played_ms);
}

/** A condensed round's steps (rule 6): the holder and the moments inside it, in queue order. */
function condensedSteps(
  outs: SlotOut[],
  out: SlotOut,
  moments: Map<string, MomentRow>,
  air: AirSettings,
): Record<string, unknown>[] | null {
  if (out.granted !== "hero") return null;
  const inside = outs
    .filter((o) => o.inside_of === out.moment_id && o.granted === "inside")
    .sort((a, b) => a.queued_since - b.queued_since);
  if (inside.length === 0) return null;
  const all = [out, ...inside].map((o) => moments.get(o.moment_id) as MomentRow);
  const ms = Math.min(
    STEP_MAX_MS,
    Math.max(STEP_MIN_MS, Math.round(air.min_on_air_ms / all.length)),
  );
  return all.map((m) => ({ template: m.template, content: m.content, duration_ms: ms }));
}

interface Sent extends SentOverride {
  steps: Record<string, unknown>[] | null;
  starts_at: string;
}

/** Sends, changes or ends the moment's override on this zone as the plan wants it. */
async function send(
  c: SqlClient,
  outbox: Outbox,
  m: MomentRow,
  s: SlotRow,
  out: SlotOut,
  rank: number,
  condensed: Record<string, unknown>[] | null,
  from: Date,
  actor: Actor | null,
  reason: EndReason,
): Promise<void> {
  if (out.regions === null) {
    await withdraw(c, outbox, s, reason, actor, false);
    return;
  }
  const by = actor?.user_id ?? null;
  const base = {
    kind: m.kind,
    zones: [s.zone_key],
    rank,
    template: m.template,
    content: m.content,
    regions: out.regions,
    expires_at: s.ends_at?.toISOString() ?? null,
    steps: condensed ?? m.steps,
  };
  if (s.override_id === null) {
    s.generation += 1;
    const id = `${m.id}.${s.zone_key}${s.generation > 1 ? `.${String(s.generation)}` : ""}`;
    // Screen plays steps from `starts_at`: one held back goes on where it stopped (rule 2).
    const next: Sent = {
      id,
      ...base,
      starts_at: from.toISOString(),
    };
    s.override_id = id;
    await putOverride(c, m.id, next);
    await outbox.add(
      c,
      "moments.override.started",
      { override: wire(m, next), actor_user_id: by },
      { version: 1 },
    );
    return;
  }
  const before = (await liveOverrides(c, m.id)).find((o) => o.override_id === s.override_id)
    ?.sent as Sent | undefined;
  if (before === undefined) {
    s.override_id = null;
    return send(c, outbox, m, s, out, rank, condensed, from, actor, reason);
  }
  // A round newly condensed starts its steps now, not when the holder first waited in the rail.
  const newlyCondensed =
    (before.steps ?? null) === null && base.steps !== null && condensed !== null;
  const next: Sent = {
    id: before.id,
    ...base,
    starts_at: newlyCondensed ? from.toISOString() : before.starts_at,
  };
  const changed = overrideChanges(before, next);
  if (!isDeepStrictEqual(before.steps ?? null, next.steps)) changed.push("steps");
  if (changed.length === 0) return;
  await putOverride(c, m.id, next);
  await outbox.add(
    c,
    "moments.override.changed",
    { override: wire(m, next), changed, actor_user_id: by },
    { version: 1 },
  );
}

/** Takes the moment's override off its zone; `drop` also forgets the slot (it left the zone). */
export async function withdraw(
  c: SqlClient,
  outbox: Outbox,
  s: SlotRow,
  reason: EndReason,
  actor: Actor | null,
  drop: boolean,
): Promise<void> {
  if (s.override_id !== null) {
    await endOverride(c, s.override_id);
    await outbox.add(
      c,
      "moments.override.ended",
      {
        override_id: s.override_id,
        zones: [s.zone_key],
        reason,
        final: true,
        actor_user_id: actor?.user_id ?? null,
      },
      { version: 1 },
    );
    s.override_id = null;
  }
  if (drop) await dropSlot(c, s.moment_id, s.zone_key);
}

/** Every slot of an ended moment comes off its zone; the zones it held get a pass. */
export async function withdrawAll(
  c: SqlClient,
  outbox: Outbox,
  m: MomentRow,
  reason: EndReason,
  actor: Actor | null,
): Promise<string[]> {
  const zones: string[] = [];
  for (const s of await slotsOf(c, m.id)) {
    await withdraw(c, outbox, s, reason, actor, true);
    zones.push(s.zone_key);
  }
  return zones;
}

/** The Override as the events carry it (events.md, Screen overrides; screen.md, claims). */
function wire(m: MomentRow, s: Sent): Record<string, unknown> {
  return {
    id: s.id,
    kind: s.kind,
    zones: s.zones,
    rank: s.rank,
    template: s.template,
    content: s.content,
    regions: s.regions,
    expires_at: s.expires_at,
    source: m.source,
    effect: m.effect,
    sound: null,
    steps: s.steps,
    on_end: "resume",
    starts_at: s.starts_at,
    ends_at: null,
  };
}
