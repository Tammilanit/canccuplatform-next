/** The storyboards' rows (contracts/moments.md, Storyboards); every function runs in the caller's tenant transaction. */
import type { SqlClient } from "@canccu/kit";
import type { Actor } from "../store.js";
import { PRESETS, RETIRED_PRESETS } from "./presets.js";
import type { Story } from "./model.js";
import { DEFAULT_TIMING } from "./timing.js";
import type { Timing } from "./timing.js";

/** The event's storyboard settings: the timing (SL1), the airtime cap (SO1) and the hand-over (SD9). */
export interface StorySettings extends Timing {
  /** Storyboards hold a zone's regions at most this share of any 10 minutes, 20 to 80 %. */
  airtime_percent: number;
  /** A phase waits at most this long for a story's round to end, 0 to 120 s. */
  handover_seconds: number;
}

export const DEFAULT_SETTINGS: StorySettings = {
  ...DEFAULT_TIMING,
  airtime_percent: 40,
  handover_seconds: 30,
};

/** What the tick knows of the event: captured from the tenants module, kept in the row. */
export interface EventFacts {
  name: string;
  hostname: string | null;
  time_zone: string;
  starts_at: string | null;
  ends_at: string | null;
}

export const NO_EVENT: EventFacts = {
  name: "",
  hostname: null,
  time_zone: "UTC",
  starts_at: null,
  ends_at: null,
};

export interface StoryDoc {
  stories: Story[];
  settings: StorySettings;
  event: EventFacts;
  revision: number;
  copied: boolean;
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export async function loadStories(c: SqlClient): Promise<StoryDoc> {
  const { rows } = await c.query(
    `SELECT stories, settings, event, revision FROM moments_stories`,
    [],
  );
  const r = rows[0];
  if (r === undefined)
    return {
      stories: copy([...PRESETS]),
      settings: { ...DEFAULT_SETTINGS },
      event: { ...NO_EVENT },
      revision: 0,
      copied: false,
    };
  return {
    stories: (r.stories as Story[]).filter((s) => !RETIRED_PRESETS.has(s.preset ?? "")),
    settings: { ...DEFAULT_SETTINGS, ...(r.settings as Partial<StorySettings>) },
    event: { ...NO_EVENT, ...(r.event as Partial<EventFacts>) },
    revision: r.revision as number,
    copied: true,
  };
}

/** The presets copied on first use (O7), at revision 0; an event's copy never changes by itself. */
export async function ensureStories(c: SqlClient): Promise<StoryDoc> {
  await c.query(
    `INSERT INTO moments_stories (stories, settings, event, revision) VALUES ($1, $2, $3, 0)
     ON CONFLICT DO NOTHING`,
    [JSON.stringify(PRESETS), JSON.stringify(DEFAULT_SETTINGS), JSON.stringify(NO_EVENT)],
  );
  return loadStories(c);
}

export async function writeStories(
  c: SqlClient,
  stories: Story[],
  settings: StorySettings,
  revision: number,
): Promise<void> {
  await ensureStories(c);
  await c.query(`UPDATE moments_stories SET stories = $1, settings = $2, revision = $3`, [
    JSON.stringify(stories),
    JSON.stringify(settings),
    revision,
  ]);
}

/** Keeps what the tick needs of the event, when it changed. */
export async function noteEvent(c: SqlClient, e: EventFacts): Promise<void> {
  await ensureStories(c);
  await c.query(`UPDATE moments_stories SET event = $1 WHERE event IS DISTINCT FROM $1::jsonb`, [
    JSON.stringify(e),
  ]);
}

/** One segment of a round on screen: its steps or its video, as one moment of the run. */
export interface Segment {
  kind: "steps" | "video";
  /** Planned start and end on the server clock, ms. */
  from_ms: number;
  until_ms: number;
  steps: Record<string, unknown>[];
  /** The planned step starts that may sound, with their cue (first pass only). */
  sounds: { at_ms: number; cue: string; key: string }[];
  moment_id: string | null;
}

export interface RoundState {
  index: number;
  finale: boolean;
  started_at: number;
  until_ms: number;
  segments: Segment[];
  sounds_round: boolean;
  /** Sound keys already decided this round. */
  decided: string[];
  /** A video segment paused by an emergency or an urgent moment since, or null. */
  paused_at: number | null;
}

export interface RunRow {
  id: string;
  story_key: string;
  source: string;
  trigger_kind: string;
  t: Date;
  item_id: string | null;
  facts: Record<string, string>;
  zones: string[];
  test: boolean;
  status: "live" | "ended";
  next_round: number;
  rounds_played: number;
  round: RoundState | null;
  finale_due: boolean;
  deferred_until: Date | null;
  sounds: Record<string, { run: number; round: number }>;
  uncounted_ms: number;
  why: string;
  actor_user_id: string | null;
  actor_name: string | null;
  started_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
}

const COLUMNS = `id, story_key, source, trigger_kind, t, item_id, facts, zones, test, status,
  next_round, rounds_played, round, finale_due, deferred_until, sounds, uncounted_ms, why,
  actor_user_id, actor_name, started_at, ended_at, end_reason`;

const runOf = (r: Record<string, unknown>): RunRow =>
  ({ ...r, uncounted_ms: Number(r.uncounted_ms) }) as unknown as RunRow;

export async function insertRun(c: SqlClient, r: RunRow): Promise<void> {
  await c.query(
    `INSERT INTO moments_story_runs (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
    values(r),
  );
}

export async function saveRun(c: SqlClient, r: RunRow): Promise<void> {
  await c.query(
    `UPDATE moments_story_runs SET story_key = $2, source = $3, trigger_kind = $4, t = $5,
       item_id = $6, facts = $7, zones = $8, test = $9, status = $10, next_round = $11,
       rounds_played = $12, round = $13, finale_due = $14, deferred_until = $15, sounds = $16,
       uncounted_ms = $17, why = $18, actor_user_id = $19, actor_name = $20, started_at = $21,
       ended_at = $22, end_reason = $23
     WHERE id = $1`,
    values(r),
  );
}

function values(r: RunRow): unknown[] {
  return [
    r.id,
    r.story_key,
    r.source,
    r.trigger_kind,
    r.t,
    r.item_id,
    JSON.stringify(r.facts),
    r.zones,
    r.test,
    r.status,
    r.next_round,
    r.rounds_played,
    r.round === null ? null : JSON.stringify(r.round),
    r.finale_due,
    r.deferred_until,
    JSON.stringify(r.sounds),
    r.uncounted_ms,
    r.why,
    r.actor_user_id,
    r.actor_name,
    r.started_at,
    r.ended_at,
    r.end_reason,
  ];
}

/** Live runs, oldest first, locked: two containers' ticks never run one twice. */
export async function liveRuns(
  c: SqlClient,
  where = "TRUE",
  args: unknown[] = [],
  wait = false,
): Promise<RunRow[]> {
  const { rows } = await c.query(
    `SELECT ${COLUMNS} FROM moments_story_runs WHERE status = 'live' AND (${where})
     ORDER BY started_at, id FOR UPDATE${wait ? "" : " SKIP LOCKED"}`,
    args,
  );
  return rows.map(runOf);
}

export async function lockRun(c: SqlClient, id: string): Promise<RunRow | null> {
  const { rows } = await c.query(
    `SELECT ${COLUMNS} FROM moments_story_runs WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] ? runOf(rows[0]) : null;
}

/** The runs of the last day and the live ones, newest first: On air and the builder read them. */
export async function recentRuns(c: SqlClient, now: Date): Promise<RunRow[]> {
  const { rows } = await c.query(
    `SELECT ${COLUMNS} FROM moments_story_runs
     WHERE status = 'live' OR started_at > $1::timestamptz - interval '1 day'
     ORDER BY started_at DESC LIMIT 200`,
    [now],
  );
  return rows.map(runOf);
}

/** Whether a run of the story with this source exists (any status) since `since`. */
export async function runSince(
  c: SqlClient,
  story: string,
  source: string | null,
  since: Date,
): Promise<RunRow | null> {
  const { rows } = await c.query(
    `SELECT ${COLUMNS} FROM moments_story_runs WHERE story_key = $1 AND started_at >= $2
       AND ($3::text IS NULL OR source = $3) AND NOT test
     ORDER BY started_at DESC LIMIT 1`,
    [story, since, source],
  );
  return rows[0] ? runOf(rows[0]) : null;
}

export async function readMark<T>(c: SqlClient, key: string): Promise<T | null> {
  const { rows } = await c.query(`SELECT value FROM moments_story_marks WHERE key = $1`, [key]);
  return (rows[0]?.value as T | undefined) ?? null;
}

export async function writeMark(c: SqlClient, key: string, value: unknown): Promise<void> {
  await c.query(
    `INSERT INTO moments_story_marks (key, value) VALUES ($1, $2)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}

export const actorOfRun = (r: RunRow): Actor | null =>
  r.actor_user_id === null ? null : { user_id: r.actor_user_id, name: r.actor_name ?? "" };
