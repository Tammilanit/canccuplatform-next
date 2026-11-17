/**
 * The phase hand-over (the storyboards plan, Phase hand-over; SD9): a zone's new scene waits for
 * a story's round live there to end, at most the event's hand-over time (30 s, 0 to 120), so the
 * story that announces the phase plays first. Never longer: a story cannot hold a zone out of it.
 */
import type { SqlClient } from "@canccu/kit";
import { loadStories, readMark, writeMark } from "./store.js";

export async function holdsHandover(c: SqlClient, zone: string, now: Date): Promise<boolean> {
  const { rows } = await c.query(
    `SELECT 1 FROM moments_story_runs WHERE status = 'live' AND round IS NOT NULL
       AND (round->>'until_ms')::bigint > $1 AND (cardinality(zones) = 0 OR $2 = ANY (zones)) LIMIT 1`,
    [now.getTime(), zone],
  );
  const key = `handover:${zone}`;
  const since = await readMark<number>(c, key);
  if (rows.length === 0) {
    if (since !== null) await c.query(`DELETE FROM moments_story_marks WHERE key = $1`, [key]);
    return false;
  }
  const limit = (await loadStories(c)).settings.handover_seconds * 1000;
  if (since === null) await writeMark(c, key, now.getTime());
  return now.getTime() - (since ?? now.getTime()) < limit;
}
