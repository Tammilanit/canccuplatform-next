/**
 * One round of a run on screen (the storyboards plan, Direction, Sound, The video step): it
 * compiles to one Override with `steps` (SD1); a round with a video step is placed as
 * back-to-back moments of the run (the steps before it, the video full screen, the steps after
 * it), each started by the tick at its planned time. A step's cue is decided per zone at its
 * start, only where the round is placed and not hidden, within the story's cap. An emergency or
 * an urgent moment pauses a video; it resumes where it stopped, its end and start moved on.
 */
import type { SqlClient } from "@canccu/kit";
import type { Engine } from "../engine.js";
import { knownZones, lockMoment, saveMoment, writeHistory } from "../store.js";
import type { Actor } from "../store.js";
import { emergencyOn } from "../cues/store.js";
import { fillContent } from "./fill.js";
import type { FillContext } from "./fill.js";
import { roundCount } from "./model.js";
import type { Story } from "./model.js";
import { patienceMs } from "./schedule.js";
import type { Compiled } from "./timing.js";
import type { EventFacts, RoundState, RunRow, Segment, StorySettings } from "./store.js";
import { actorOfRun } from "./store.js";

/** At most 2 story sounds a round and 6 a run, per zone (SO2). */
export const ROUND_SOUNDS = 2;
export const RUN_SOUNDS = 6;
/** A step's sound waits this long for Screen to report where its round is placed. */
const PLACEMENT_WAIT_MS = 3000;
/** A video moment starts this early, so the screens have it before its planned start. */
const VIDEO_EARLY_MS = 1000;

export interface Ctx {
  c: SqlClient;
  engine: Engine;
  now: Date;
  settings: StorySettings;
  event: EventFacts;
}

export const regionsOf = (s: Story): string[] => (s.full_screen ? ["full"] : ["hero", "rail"]);

export async function history(
  ctx: Ctx,
  run: RunRow,
  story: Pick<Story, "name">,
  action: "round_started" | "round_skipped" | "loop_ended" | "not_fired",
  outcome: string,
  extra: { zone?: string | null; displaced?: string | null; moment_id?: string | null } = {},
): Promise<void> {
  await writeHistory(ctx.c, {
    at: ctx.now,
    zone_key: extra.zone ?? null,
    action,
    moment_id: extra.moment_id ?? null,
    class: "storyboard",
    origin: run.actor_user_id === null ? "rule" : "crew",
    title: story.name,
    why: run.why,
    outcome,
    displaced: extra.displaced ?? null,
    actor: actorOfRun(run),
  });
}

/** The zones in a quiet scene now (E11): their scene's `quiet`. */
export async function quietZones(c: SqlClient): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT zone_key FROM moments_scene_zones WHERE (sent->'scene'->>'quiet')::boolean IS TRUE`,
    [],
  );
  return rows.map((r) => r.zone_key as string);
}

/** The run's zones as a list; empty (every zone) stays empty unless some must be left out. */
export async function zonesWithout(
  c: SqlClient,
  zones: string[],
  out: string[],
): Promise<string[] | null> {
  if (out.length === 0) return zones;
  const all = zones.length > 0 ? zones : await knownZones(c);
  const kept = all.filter((z) => !out.includes(z));
  return kept.length === 0 ? null : kept;
}

/** The round as segments on the server clock, its texts filled now (each round is filled fresh). */
export async function buildRound(
  ctx: Ctx,
  run: RunRow,
  story: Story,
  compiled: Compiled,
  index: number,
  finale: boolean,
  startMs: number,
  sounds: boolean,
  quiet: string[],
): Promise<RoundState> {
  const fill: FillContext = {
    facts: run.facts,
    now: ctx.now.getTime(),
    t: run.t.getTime(),
    timeZone: ctx.event.time_zone,
    eventName: ctx.event.name,
    eventStartsAt: ctx.event.starts_at,
    eventEndsAt: ctx.event.ends_at,
    hostname: ctx.event.hostname,
  };
  const videoZones = await zonesWithout(ctx.c, run.zones, quiet);
  const segments: Segment[] = [];
  let at = startMs;
  for (const p of compiled.steps) {
    if (p.video && videoZones === null) continue; // Skipped in a quiet scene: the other steps play.
    const kind = p.video ? "video" : "steps";
    let seg = segments.at(-1);
    if (seg === undefined || seg.kind === "video" || kind === "video") {
      seg = { kind, from_ms: at, until_ms: at, steps: [], sounds: [], moment_id: null };
      segments.push(seg);
    }
    const effect = p.cue === null ? null : await ctx.engine.sound?.picture(ctx.c, p.cue);
    seg.steps.push({
      template: p.template,
      content: p.video ? p.content : fillContent(p.template, p.content, fill),
      duration_ms: Math.max(500, Math.min(60_000, p.duration_ms)),
      transition: p.transition,
      effect: effect ?? null,
      sound: null,
      ...(p.video ? { video_ms: p.duration_ms } : {}),
    });
    if (p.cue !== null && p.pass === 0 && sounds && (run.facts["@silent"] ?? "") === "")
      seg.sounds.push({ at_ms: at, cue: p.cue, key: String(p.step) });
    at += p.duration_ms;
    seg.until_ms = at;
  }
  return {
    index,
    finale,
    started_at: startMs,
    until_ms: at,
    segments,
    sounds_round: sounds,
    decided: [],
    paused_at: null,
  };
}

async function startSegment(
  ctx: Ctx,
  run: RunRow,
  story: Story,
  seg: Segment,
  i: number,
): Promise<string> {
  const round = run.round as RoundState;
  const actor: Actor | null = actorOfRun(run);
  const first = seg.steps[0] ?? { template: "title_card", content: {} };
  const video = seg.kind === "video";
  let zones = run.zones;
  let content = first.content as Record<string, unknown>;
  if (video) {
    zones = (await zonesWithout(ctx.c, run.zones, await quietZones(ctx.c))) ?? [];
    const muted =
      (await ctx.engine.sound?.video(ctx.c, zones, seg.until_ms, run.id, ctx.now)) ?? [];
    content = {
      ...content,
      started_at: new Date(seg.from_ms).toISOString(),
      paused_at: null,
      muted_zones: muted,
    };
  }
  const r = await ctx.engine.request(
    ctx.c,
    {
      class: "storyboard",
      template: video ? "video" : (first.template as string),
      content,
      steps: video ? null : seg.steps,
      origin: actor === null ? "rule" : "crew",
      rule_id: `story:${story.key}`,
      why: run.why,
      regions: video ? ["full"] : regionsOf(story),
      zones,
      starts_at: new Date(seg.from_ms),
      expires_at: new Date(seg.until_ms),
      patience_seconds: Math.ceil(patienceMs(story) / 1000),
      source: { module: "moments", event_id: null, ref: run.source },
      dedupe_key: `story:${run.id}:${String(round.index)}:${round.finale ? "f" : ""}${String(i)}`,
      happening: run.facts["@happening"] ?? null,
      refuse: false,
      actor,
    },
    ctx.now,
  );
  if (r.status === "refused") {
    await history(
      ctx,
      run,
      story,
      "round_skipped",
      `${label(run, story)} skipped: one owner per happening`,
      {
        displaced: r.held_by,
      },
    );
    return "refused";
  }
  return r.moment.id;
}

export const label = (run: RunRow, story: Story): string => {
  const r = run.round;
  if (r?.finale === true) return "finale";
  const n = roundCount(story);
  return `round ${String((r?.index ?? run.next_round) + 1)}${n === null ? "" : ` of ${String(n)}`}`;
};

/** Where a segment's moment is placed and shown now, and whether Screen has said so yet. */
async function shownOn(
  c: SqlClient,
  momentId: string,
): Promise<{ shown: string[]; known: string[] }> {
  const { rows } = await c.query(
    `SELECT zone_key, state FROM moment_placements WHERE moment_id = $1`,
    [momentId],
  );
  const r = rows as { zone_key: string; state: string }[];
  return {
    shown: r.filter((x) => x.state === "placed").map((x) => x.zone_key),
    known: r.map((x) => x.zone_key),
  };
}

async function soundStep(
  ctx: Ctx,
  run: RunRow,
  seg: Segment,
  s: Segment["sounds"][number],
): Promise<boolean> {
  const round = run.round as RoundState;
  const at = ctx.now.getTime();
  const placed = await shownOn(ctx.c, seg.moment_id as string);
  const zones = run.zones.length > 0 ? run.zones : await knownZones(ctx.c);
  const waiting = zones.filter((z) => !placed.known.includes(z));
  if (waiting.length > 0 && at - s.at_ms < PLACEMENT_WAIT_MS) return false;
  const key = `story:${run.id}:${String(round.index)}${round.finale ? "f" : ""}:${s.key}`;
  for (const zone of zones) {
    const count = run.sounds[zone] ?? { run: 0, round: 0 };
    if (!placed.shown.includes(zone)) {
      await ctx.engine.sound?.skipped(ctx.c, zone, s.cue, key, "hidden", ctx.now);
      continue;
    }
    if (count.round >= ROUND_SOUNDS || count.run >= RUN_SOUNDS) {
      await ctx.engine.sound?.skipped(ctx.c, zone, s.cue, key, "story_cap", ctx.now);
      continue;
    }
    const out = await ctx.engine.fireCue(
      ctx.c,
      { cue: s.cue, zones: [zone], key, source: key, flood: `run:${run.id}` },
      ctx.now,
    );
    if (out.some((o) => o.outcome === "played" || o.outcome === "queued"))
      run.sounds[zone] = { run: count.run + 1, round: count.round + 1 };
  }
  return true;
}

/** An emergency or an urgent moment on the run's zones pauses its video. */
async function pausing(c: SqlClient, zones: string[]): Promise<boolean> {
  for (const zone of zones.length > 0 ? zones : await knownZones(c))
    if (await emergencyOn(c, zone)) return true;
  const { rows } = await c.query(
    `SELECT 1 FROM moments WHERE ended_at IS NULL AND class = 'announcement'
       AND content->>'level' = 'urgent'
       AND (cardinality(zones) = 0 OR cardinality($1::text[]) = 0 OR zones && $1::text[]) LIMIT 1`,
    [zones],
  );
  return rows.length > 0;
}

/** Pauses or resumes the live video: on resume every later time moves by the pause. */
async function followPause(ctx: Ctx, run: RunRow, i: number): Promise<void> {
  const round = run.round as RoundState;
  const seg = round.segments[i] as Segment;
  const m = await lockMoment(ctx.c, seg.moment_id as string);
  if (m === null || m.ended_at !== null) return;
  const at = ctx.now.getTime();
  const paused = await pausing(ctx.c, run.zones);
  if (paused && round.paused_at === null) {
    round.paused_at = at;
    await ctx.engine.setContent(
      ctx.c,
      m,
      { ...m.content, paused_at: ctx.now.toISOString() },
      ctx.now,
    );
  } else if (!paused && round.paused_at !== null) {
    const d = at - round.paused_at;
    round.paused_at = null;
    for (const later of round.segments.slice(i)) {
      later.from_ms += d;
      later.until_ms += d;
      for (const s of later.sounds) s.at_ms += d;
    }
    round.until_ms += d;
    run.uncounted_ms += d;
    // The story's later rounds move by the pause too (PV1).
    run.t = new Date(run.t.getTime() + d);
    m.expires_at = new Date(seg.until_ms);
    m.content = { ...m.content, started_at: new Date(seg.from_ms).toISOString(), paused_at: null };
    await saveMoment(ctx.c, m);
    await ctx.engine.show(ctx.c, m, null, "cleared");
  }
}

/**
 * Plays the live round on: starts its segments when due, pauses and resumes its video, decides
 * its steps' sounds. Answers how it stands: `playing`, `done` (its time is over) or `held`
 * (its moments gave up the region, or one owner refused it: skipped).
 */
export async function playRound(
  ctx: Ctx,
  run: RunRow,
  story: Story,
): Promise<"playing" | "done" | "held"> {
  const round = run.round as RoundState;
  const at = ctx.now.getTime();
  for (const [i, seg] of round.segments.entries()) {
    const early = seg.kind === "video" ? VIDEO_EARLY_MS : 0;
    if (seg.moment_id === null && at >= seg.from_ms - early && at < seg.until_ms) {
      // The steps before a video end where it starts: back to back, never both on screen.
      seg.moment_id = await startSegment(ctx, run, story, seg, i);
      if (seg.moment_id === "refused") return "held";
    }
    if (seg.moment_id === null || seg.moment_id === "refused") continue;
    if (seg.kind === "video" && at < seg.until_ms) await followPause(ctx, run, i);
    for (const s of seg.sounds) {
      if (s.at_ms > at || round.decided.includes(s.key)) continue;
      if (round.paused_at !== null) continue;
      if (await soundStep(ctx, run, seg, s)) round.decided.push(s.key);
    }
  }
  const ids = round.segments.flatMap((s) =>
    s.moment_id === null || s.moment_id === "refused" ? [] : [s.moment_id],
  );
  const last = ids.at(-1);
  const m = last === undefined ? null : await lockMoment(ctx.c, last);
  const over =
    (at >= round.until_ms && round.paused_at === null) ||
    (m?.ended_at != null && m.end_reason === "preempted");
  if (!over) return "playing";
  return (await neverShown(ctx.c, ids)) ? "held" : "done";
}

/** Screen said the round waited and never placed it anywhere: its region was held (SE1). */
async function neverShown(c: SqlClient, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return false;
  const { rows } = await c.query(
    `SELECT bool_or(action IN ('placed', 'back')) AS shown, bool_or(action = 'queued') AS waited
     FROM moments_history WHERE moment_id = ANY ($1::text[])`,
    [ids],
  );
  const r = rows[0] as { shown: boolean | null; waited: boolean | null } | undefined;
  return r?.waited === true && r.shown !== true;
}

/** Ends the live round's moments now (an end event, the crew's stop or skip). */
export async function endRound(
  ctx: Ctx,
  run: RunRow,
  reason: "source_ended" | "cleared",
): Promise<void> {
  for (const seg of run.round?.segments ?? []) {
    if (seg.moment_id === null || seg.moment_id === "refused") continue;
    const m = await lockMoment(ctx.c, seg.moment_id);
    if (m !== null && m.ended_at === null)
      await ctx.engine.end(ctx.c, m, reason, actorOfRun(run), ctx.now);
  }
  run.round = null;
}
