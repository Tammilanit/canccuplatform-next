/**
 * A story fires (the storyboards plan, Triggers as decided; SD4, SD7): any one trigger starts
 * it, the conditions all hold when it fires (else the history says which did not, once per
 * source), and the run mode says what a second fire does while it runs. The run's first round
 * is due at once when its time has come (a late take plays the round due now, as SE4's restart).
 */
import { randomUUID } from "node:crypto";
import type { SqlClient } from "@canccu/kit";
import type { Actor } from "../store.js";
import { knownZones } from "../store.js";
import type { EnergyLevel, Story } from "./model.js";
import { ENERGIES } from "./model.js";
import type { Facts } from "./fill.js";
import { history, quietZones } from "./round.js";
import type { Ctx } from "./round.js";
import { compiledOf, endRun, stepRun } from "./runner.js";
import { atLocal, localParts, roundAt } from "./schedule.js";
import { insertRun, lockRun, readMark, runSince, writeMark } from "./store.js";
import type { RunRow } from "./store.js";
import { runOfShow } from "../announce/store.js";
import type { RunItem } from "../announce/store.js";

export interface Occurrence {
  kind: Story["triggers"][number]["kind"];
  /** What `per_source` and `once` per source key on. */
  source: string;
  t: number;
  item_id: string | null;
  /** The item's zone, or the zone a scene trigger fired on. */
  zone: string | null;
  facts: Facts;
  why: string;
  actor?: Actor | null;
  /** A test-fire: one round on one zone, silent unless chosen (SU4). */
  test?: { zone: string; sound: boolean } | null;
}

export type Fired = { run: RunRow } | { not: string };

const minutesOf = (hhmm: string): number =>
  Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function inWindow(w: { from: string; until: string }, minutes: number): boolean {
  const from = minutesOf(w.from);
  const until = minutesOf(w.until);
  return from <= until ? minutes >= from && minutes < until : minutes >= from || minutes < until;
}

/** The zones it plays on, or why it does not fire: zones, scenes, energy and quiet (all must hold). */
async function zonesFor(
  ctx: Ctx,
  s: Story,
  o: Occurrence,
  energyOf: (z: string) => Promise<string | null>,
): Promise<string[] | string> {
  const k = s.conditions;
  let zones = k.zones;
  if (k.item_zone && o.zone !== null) zones = [o.zone];
  if (o.kind === "scene" && o.zone !== null) zones = [o.zone];
  const zoneBound =
    k.scenes.length > 0 ||
    k.not_scenes.length > 0 ||
    k.energy_min !== null ||
    k.energy_max !== null ||
    k.quiet === "skip";
  if (!zoneBound) return zones;
  const all = zones.length > 0 ? zones : await knownZones(ctx.c);
  const { rows } = await ctx.c.query(`SELECT zone_key, scene_key FROM moments_scene_zones`, []);
  const sceneOf = new Map(rows.map((r) => [r.zone_key as string, r.scene_key as string | null]));
  const quiet = await quietZones(ctx.c);
  const rank = (e: string | null) => ENERGIES.indexOf((e === "quiet" ? "calm" : e) as EnergyLevel);
  const kept: string[] = [];
  let why = "";
  for (const z of all) {
    const scene = sceneOf.get(z) ?? null;
    if (k.scenes.length > 0 && (scene === null || !k.scenes.includes(scene))) {
      why = `${z} is not in ${k.scenes.join(" or ")}`;
      continue;
    }
    if (scene !== null && k.not_scenes.includes(scene)) {
      why = `${z} is in ${scene}`;
      continue;
    }
    if (k.quiet === "skip" && quiet.includes(z)) {
      why = `not in quiet (${z})`;
      continue;
    }
    if (k.energy_min !== null || k.energy_max !== null) {
      const e = rank(await energyOf(z));
      if (k.energy_min !== null && e < ENERGIES.indexOf(k.energy_min)) {
        why = `${z} is calmer than ${k.energy_min}`;
        continue;
      }
      if (k.energy_max !== null && e > ENERGIES.indexOf(k.energy_max)) {
        why = `${z} is livelier than ${k.energy_max}`;
        continue;
      }
    }
    kept.push(z);
  }
  if (kept.length === 0) return why || "no zone";
  return zones.length === 0 && kept.length === all.length ? [] : kept;
}

/** Why the story's own conditions say no now (window, days, once, cooldown), or null. */
async function notNow(ctx: Ctx, s: Story, o: Occurrence): Promise<string | null> {
  const k = s.conditions;
  const local = localParts(ctx.now.getTime(), ctx.event.time_zone);
  if (k.window !== null && !inWindow(k.window, local.minutes))
    return `outside ${k.window.from}–${k.window.until}`;
  if (k.days.length > 0 && !k.days.includes(local.date)) return "not on this day";
  const epoch = new Date(0);
  if (k.once === "event" && (await runSince(ctx.c, s.key, null, epoch)) !== null)
    return "once per event: it ran";
  if (k.once === "source" && (await runSince(ctx.c, s.key, o.source, epoch)) !== null)
    return "once per source: it ran";
  if (k.once === "day") {
    const midnight = atLocal(local.date, "00:00", ctx.event.time_zone);
    if ((await runSince(ctx.c, s.key, null, new Date(midnight))) !== null)
      return "once per day: it ran today";
  }
  if (
    k.cooldown_minutes > 0 &&
    (await runSince(
      ctx.c,
      s.key,
      null,
      new Date(ctx.now.getTime() - k.cooldown_minutes * 60_000),
    )) !== null
  )
    return `cooldown ${String(k.cooldown_minutes)} min`;
  return null;
}

async function notFired(ctx: Ctx, s: Story, o: Occurrence, why: string): Promise<Fired> {
  // Item and clock triggers are looked at every tick: the history says it once per source.
  const mark = `nf:${s.key}:${o.source}`;
  if ((await readMark(ctx.c, mark)) === null) {
    await writeMark(ctx.c, mark, ctx.now.toISOString());
    const fake = {
      why: o.why,
      test: false,
      actor_user_id: o.actor?.user_id ?? null,
      actor_name: o.actor?.name ?? null,
    } as RunRow;
    await history(ctx, fake, s, "not_fired", `not fired: ${why}`);
  }
  return { not: why };
}

/** The next public item on the zone after `t`, for `until_event: next_item_starts` (fix 10). */
export function nextItemOf(
  items: (RunItem & { zone?: string | null })[],
  zone: string | null,
  t: number,
): RunItem | undefined {
  return items
    .filter(
      (i) => (i.visibility ?? "public") === "public" && (i.status ?? "scheduled") === "scheduled",
    )
    .filter((i) => zone === null || i.zone == null || i.zone === zone)
    .filter((i) => Date.parse(i.starts_at) > t)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
}

async function nextItem(c: SqlClient, zone: string | null, t: number): Promise<Facts | null> {
  const next = nextItemOf((await runOfShow(c)) ?? [], zone, t);
  return next === undefined
    ? null
    : { "next.title": next.title, "@next.starts_at": next.starts_at };
}

/** Fires `s` for one occurrence: a new run, or why not. */
export async function fireStory(
  ctx: Ctx,
  s: Story,
  o: Occurrence,
  energyOf: (z: string) => Promise<string | null> = () => Promise.resolve(null),
): Promise<Fired> {
  let zones: string[];
  if (o.test != null) zones = [o.test.zone];
  else {
    const no = await notNow(ctx, s, o);
    if (no !== null) return notFired(ctx, s, o, no);
    const z = await zonesFor(ctx, s, o, energyOf);
    if (typeof z === "string") return notFired(ctx, s, o, z);
    zones = z;
    const { rows } = await ctx.c.query(
      `SELECT id, source FROM moments_story_runs WHERE story_key = $1 AND status = 'live' AND NOT test
       ORDER BY started_at FOR UPDATE`,
      [s.key],
    );
    const live = rows as { id: string; source: string }[];
    if (s.run_mode === "ignore" && live.length > 0) return notFired(ctx, s, o, "it already runs");
    if (s.run_mode === "per_source" && live.some((r) => r.source === o.source))
      return notFired(ctx, s, o, "it already runs for this source");
    if (s.run_mode === "restart")
      for (const r of live) {
        const old = await lockRun(ctx.c, r.id);
        if (old !== null) await endRun(ctx, old, s, "restarted by a new fire", "cleared");
      }
  }
  let facts = o.facts;
  if (s.end.until_event?.kind === "next_item_starts") {
    const next = await nextItem(ctx.c, o.zone, o.t);
    if (next === null)
      return notFired(ctx, s, o, `no next item${o.zone === null ? "" : ` on ${o.zone}`}`);
    facts = {
      ...facts,
      ...next,
      "next.starts_at": localParts(Date.parse(next["@next.starts_at"] ?? ""), ctx.event.time_zone)
        .hhmm,
    };
  }
  if (o.test?.sound === true) facts = { ...facts, "@test_sound": "1" };
  const run: RunRow = {
    id: `run_${randomUUID()}`,
    story_key: s.key,
    source: o.source,
    trigger_kind: o.kind,
    t: new Date(o.t),
    item_id: o.item_id,
    facts,
    zones,
    test: o.test != null,
    status: "live",
    next_round: 0,
    rounds_played: 0,
    round: null,
    finale_due: false,
    deferred_until: null,
    sounds: {},
    uncounted_ms: 0,
    why: o.why,
    actor_user_id: o.actor?.user_id ?? null,
    actor_name: o.actor?.name ?? null,
    started_at: ctx.now,
    ended_at: null,
    end_reason: null,
  };
  if (o.test != null) {
    // A test plays the first round now, whatever its offset.
    run.t = new Date(ctx.now.getTime() - (roundAt(s, 0, 0, compiledOf(s, ctx).lead_ms) ?? 0));
  }
  await insertRun(ctx.c, run);
  await stepRun(ctx, run, s, await runOfShow(ctx.c));
  return { run };
}
