/**
 * The tick's turn for storyboards (the storyboards plan, Direction, Ends, Edge cases, Airtime):
 * each live run follows its item (a delay moves T, a cancel ends it silently, SE3), plays its
 * live round, and when none is live ends by its planned end (with the finale), by the 6 h cap
 * (`until_event` only, a video's time not counted), or starts the round due now: rounds whose
 * time ran out are skipped and written so (SE1, SE2, SE4); a round over the airtime cap or behind
 * a waiting lower moment waits for the next minute (SO1). From the rows alone.
 */
import type { Logger, SqlClient } from "@canccu/kit";
import type { Engine } from "../engine.js";
import { isolated } from "../db.js";
import { runOfShow } from "../announce/store.js";
import type { RunItem } from "../announce/store.js";
import { emergencyOn } from "../cues/store.js";
import { knownZones } from "../store.js";
import { isVideo } from "./model.js";
import type { Story } from "./model.js";
import { CAP_MS, dueRound, plannedEnd, roundAt, roundSounds } from "./schedule.js";
import { compileFinale, compileRound } from "./timing.js";
import type { Compiled } from "./timing.js";
import {
  buildRound,
  endRound,
  history,
  label,
  playRound,
  quietZones,
  zonesWithout,
} from "./round.js";
import type { Ctx } from "./round.js";
import { liveRuns, loadStories, saveRun } from "./store.js";
import type { RunRow } from "./store.js";

const MINUTE = 60_000;
const TEN_MINUTES = 10 * MINUTE;
const YIELD_AFTER_MS = 60_000;
const STORYBOARD_RANK = 65;

/** A video step's own length, as the builder stored it from its asset. */
export const videoMs = (step: { content: Record<string, unknown> }): number =>
  typeof step.content.duration_ms === "number" ? step.content.duration_ms : 0;

export const compiledOf = (story: Story, ctx: Pick<Ctx, "settings">): Compiled =>
  compileRound(story.round, ctx.settings, videoMs);

/** The item a run follows and its anchor time, or why it is gone. */
function follow(
  run: RunRow,
  story: Story,
  items: RunItem[] | null,
): { t: number } | { gone: string } | null {
  if (run.item_id === null || items === null) return null;
  const item = items.find((i) => i.id === run.item_id) as
    (RunItem & { ends_at?: string | null }) | undefined;
  if (item === undefined) return { gone: "its run-of-show item was removed" };
  if (item.status === "cancelled") return { gone: `${item.title} was cancelled` };
  const trigger = story.triggers.find((t) => t.kind === "item");
  const anchor = trigger?.kind === "item" ? trigger.anchor : "start";
  const at = anchor === "end" && item.ends_at != null ? item.ends_at : item.starts_at;
  return { t: Date.parse(at) };
}

/** Whether the loop's end event has come (the item starts or ends, the next item starts). */
function untilReached(story: Story, run: RunRow, items: RunItem[] | null, at: number): boolean {
  const u = story.end.until_event;
  if (u === null || u.kind === "domain") return false;
  if (u.kind === "next_item_starts") {
    const next = run.facts["@next.starts_at"];
    return next !== undefined && Date.parse(next) <= at;
  }
  const item = items?.find((i) => i.id === run.item_id) as
    (RunItem & { ends_at?: string | null }) | undefined;
  if (item === undefined) return false;
  const when = u.kind === "item_starts" ? item.starts_at : (item.ends_at ?? null);
  return when !== null && Date.parse(when) <= at;
}

/**
 * Ends the run; `planned` ends play the finale first when the story has one (fix 3), and
 * `source_ended` (its source went past its end, #771) cuts a finale on air.
 */
export async function endRun(
  ctx: Ctx,
  run: RunRow,
  story: Story,
  why: string,
  reason: string,
): Promise<void> {
  if (run.round !== null)
    await endRound(
      ctx,
      run,
      reason === "planned" || reason === "source_ended" ? "source_ended" : "cleared",
    );
  run.status = "ended";
  run.ended_at = ctx.now;
  run.end_reason = reason;
  run.finale_due = false;
  run.deferred_until = null;
  await history(ctx, run, story, "loop_ended", `ended: ${why}`);
  await saveRun(ctx.c, run);
}

export async function planEnd(ctx: Ctx, run: RunRow, story: Story, why: string): Promise<void> {
  if (run.round !== null) await endRound(ctx, run, "source_ended");
  if (story.finale !== null && !run.test) {
    run.finale_due = true;
    run.facts = { ...run.facts, "@end": why };
    await startFinale(ctx, run, story);
    return;
  }
  await endRun(ctx, run, story, why, "planned");
}

async function startFinale(ctx: Ctx, run: RunRow, story: Story): Promise<void> {
  const quiet = story.conditions.quiet === "skip" ? await quietZones(ctx.c) : [];
  if ((await zonesWithout(ctx.c, run.zones, quiet)) === null) {
    await endRun(
      ctx,
      run,
      story,
      `${run.facts["@end"] ?? "planned"}; finale skipped: not in quiet`,
      "planned",
    );
    return;
  }
  const compiled = compileFinale(story.finale ?? [], ctx.settings);
  run.round = await buildRound(
    ctx,
    run,
    story,
    compiled,
    run.next_round,
    true,
    ctx.now.getTime(),
    true,
    quiet,
  );
  run.finale_due = false;
  await history(ctx, run, story, "round_started", "finale");
  await playRound(ctx, run, story);
  await saveRun(ctx.c, run);
}

/** Storyboards' share of the zone's last 10 minutes, were a round of `lengthMs` to start now (SO1). */
async function airtimeOver(ctx: Ctx, zones: string[], lengthMs: number): Promise<boolean> {
  const at = ctx.now.getTime();
  const from = new Date(at - TEN_MINUTES + lengthMs);
  const cap = (TEN_MINUTES * ctx.settings.airtime_percent) / 100;
  for (const zone of zones.length > 0 ? zones : await knownZones(ctx.c)) {
    const { rows } = await ctx.c.query(
      `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(ended_at, $2), COALESCE(expires_at, $2), $2)
                - GREATEST(starts_at, $1))) * 1000), 0) AS used
       FROM moments WHERE class = 'storyboard' AND template <> 'video'
         AND starts_at < $2 AND LEAST(COALESCE(ended_at, $2), COALESCE(expires_at, $2)) > $1
         AND (cardinality(zones) = 0 OR $3 = ANY (zones)) AND NOT ($3 = ANY (left_zones))`,
      [from, ctx.now, zone],
    );
    if (Number(rows[0]?.used ?? 0) + lengthMs > cap) return true;
  }
  return false;
}

/**
 * Presets the airtime cap never defers (SO1): a moment the hall waits for, one round per order.
 * Behind the cap it came minutes late, or never, on a busy screen (#775: the cap was spent by the
 * stories shot before it, so Pizza is here did not reach the hero for 2 minutes). They still yield.
 */
const UNCAPPED = new Set(["pizza_arrived"]);

/** A lower moment of the hero's chain has waited 60 s for a region (the yield rule, SO1). */
async function yieldTo(ctx: Ctx, zones: string[]): Promise<string | null> {
  const { rows } = await ctx.c.query(
    `SELECT m.template, m.content FROM moment_placements p
     JOIN moments m ON m.tenant_id = p.tenant_id AND m.id = p.moment_id
     JOIN moment_overrides o ON o.tenant_id = p.tenant_id AND o.override_id = p.override_id
     WHERE m.ended_at IS NULL AND p.state = 'unplaced' AND NOT p.placed_once
       AND m.class <> 'storyboard' AND (o.sent->>'rank')::int < $1
       AND p.since <= $2::timestamptz - make_interval(secs => $3)
       AND (cardinality($4::text[]) = 0 OR p.zone_key = ANY ($4::text[]))
     ORDER BY p.since LIMIT 1`,
    [STORYBOARD_RANK, ctx.now, YIELD_AFTER_MS / 1000, zones],
  );
  const r = rows[0] as { template: string; content: Record<string, unknown> } | undefined;
  return r === undefined
    ? null
    : typeof r.content.title === "string"
      ? r.content.title
      : r.template;
}

async function skip(ctx: Ctx, run: RunRow, story: Story, n: number, why: string): Promise<void> {
  await history(
    ctx,
    run,
    story,
    "round_skipped",
    `${label({ ...run, round: null, next_round: n }, story)} skipped: ${why}`,
  );
}

/** Starts round `n` now, or skips or defers it with the reason. */
async function startRound(
  ctx: Ctx,
  run: RunRow,
  story: Story,
  compiled: Compiled,
  n: number,
): Promise<void> {
  const at = ctx.now.getTime();
  const planned = roundAt(story, run.t.getTime(), n, compiled.lead_ms) ?? at;
  const zones = run.zones.length > 0 ? run.zones : await knownZones(ctx.c);
  const emergency = await Promise.all(zones.map((z) => emergencyOn(ctx.c, z)));
  if (zones.length > 0 && emergency.every(Boolean)) {
    run.next_round = n + 1;
    return skip(ctx, run, story, n, "an emergency holds every zone");
  }
  const quiet = await quietZones(ctx.c);
  if (story.conditions.quiet === "skip" && (await zonesWithout(ctx.c, run.zones, quiet)) === null) {
    run.next_round = n + 1;
    return skip(ctx, run, story, n, "not in quiet");
  }
  const video = story.round.steps.some(isVideo);
  // A planned premiere is never deferred, nor a test; an uncapped preset skips the cap alone.
  if (!video && !run.test) {
    const cap = !UNCAPPED.has(story.preset ?? "");
    const over = cap && (await airtimeOver(ctx, run.zones, compiled.length_ms)) ? "airtime" : null;
    const lower = over === null ? await yieldTo(ctx, run.zones) : null;
    const why = over ?? (lower === null ? null : `yield to ${lower}`);
    if (why !== null) {
      run.deferred_until = new Date(Math.floor(at / MINUTE) * MINUTE + MINUTE);
      run.facts = { ...run.facts, "@deferred": why };
      return;
    }
  }
  run.deferred_until = null;
  const sounds = run.test ? run.facts["@test_sound"] === "1" : roundSounds(story, n);
  run.round = await buildRound(ctx, run, story, compiled, n, false, planned, sounds, quiet);
  run.next_round = n + 1;
  run.rounds_played += 1;
  for (const z of Object.keys(run.sounds))
    run.sounds[z] = { run: run.sounds[z]?.run ?? 0, round: 0 };
  await history(ctx, run, story, "round_started", label(run, story));
  const state = await playRound(ctx, run, story);
  if (state === "held") run.round = null;
}

/**
 * The 6 h cap (SE5, fix 8): for loops that wait for an event, and for `every` loops the crew's
 * Stop alone ends; the others end by their count, time or clock time.
 */
export const capped = (s: Story): boolean =>
  s.end.until_event !== null ||
  (s.rounds.mode === "every" &&
    s.end.rounds === null &&
    s.end.for_minutes === null &&
    s.end.until_clock === null);

/** One live run, one tick. */
export async function stepRun(
  ctx: Ctx,
  run: RunRow,
  story: Story | undefined,
  items: RunItem[] | null,
): Promise<void> {
  const at = ctx.now.getTime();
  if (story === undefined || (!story.enabled && !run.test))
    return endRun(
      ctx,
      run,
      { name: story?.name ?? run.story_key } as Story,
      "the story was turned off",
      "cleared",
    );
  // A test-fire plays its one round now (SU4): its item only fills the placeholders, so its
  // time, a delay or its start never move or end the test.
  const f = run.test ? null : follow(run, story, items);
  if (f !== null && "gone" in f) return endRun(ctx, run, story, f.gone, "cancelled");
  if (f !== null && f.t !== run.t.getTime()) run.t = new Date(f.t);
  if (run.round?.finale === true) {
    if ((await playRound(ctx, run, story)) === "playing") return saveRun(ctx.c, run);
    run.round = null;
    return endRun(ctx, run, story, run.facts["@end"] ?? "planned", "planned");
  }
  if (run.finale_due) return startFinale(ctx, run, story);
  if (!run.test && untilReached(story, run, items, at)) {
    const u = story.end.until_event?.kind;
    return planEnd(
      ctx,
      run,
      story,
      u === "item_ends"
        ? "the item ended"
        : u === "next_item_starts"
          ? "the next item started"
          : "the item started",
    );
  }
  if (capped(story) && at - run.started_at.getTime() - run.uncounted_ms >= CAP_MS)
    return endRun(ctx, run, story, "time limit", "time_limit");
  if (run.round !== null) {
    const state = await playRound(ctx, run, story);
    if (state === "playing") return saveRun(ctx.c, run);
    if (state === "held")
      await skip(ctx, run, story, run.round.index, "its region was held past its patience");
    const video = run.round.segments.find((s) => s.kind === "video");
    if (video !== undefined && video.moment_id !== null)
      run.uncounted_ms += video.until_ms - video.from_ms;
    run.round = null;
  }
  const end = plannedEnd(story, run.t.getTime(), run.started_at.getTime(), ctx.event.time_zone);
  if (end !== null && at >= end) return planEnd(ctx, run, story, "its time is over");
  if (run.deferred_until !== null && at < run.deferred_until.getTime()) return saveRun(ctx.c, run);
  const compiled = compiledOf(story, ctx);
  const due = dueRound(story, run.t.getTime(), compiled.lead_ms, at, run.next_round);
  const reason =
    run.deferred_until !== null ? (run.facts["@deferred"] ?? "airtime") : "its time ran out";
  for (const n of due.missed) await skip(ctx, run, story, n, reason);
  if (due.missed.length > 0) run.next_round = Math.max(...due.missed) + 1;
  run.deferred_until = null;
  if (due.play !== null && !(run.test && run.rounds_played > 0)) {
    await startRound(ctx, run, story, compiled, due.play);
    return saveRun(ctx.c, run);
  }
  const more = roundAt(story, run.t.getTime(), run.next_round, compiled.lead_ms) !== null;
  if (run.test && run.rounds_played > 0)
    return endRun(ctx, run, story, "the test round played", "planned");
  if (
    !more &&
    (story.end.until_event === null ||
      (story.end.until_event.kind === "domain" &&
        run.rounds_played > 0 &&
        story.end.rounds !== null))
  )
    return planEnd(ctx, run, story, "after its last round");
  return saveRun(ctx.c, run);
}

/** The tick: every live run, one at a time, each locked so two containers never play it twice. */
export async function tickRuns(
  c: SqlClient,
  engine: Engine,
  now: Date,
  log?: Logger,
): Promise<void> {
  const doc = await loadStories(c);
  if (!doc.copied) return;
  const runs = await liveRuns(c);
  if (runs.length === 0) return;
  const ctx: Ctx = { c, engine, now, settings: doc.settings, event: doc.event, log };
  const items = await runOfShow(c);
  for (const run of runs) {
    await isolated(
      c,
      () =>
        stepRun(
          ctx,
          run,
          doc.stories.find((s) => s.key === run.story_key),
          items,
        ),
      (err) => log?.warn({ err, run: run.id }, "a story run's tick failed"),
    );
  }
}
