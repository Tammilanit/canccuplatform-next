/**
 * A zone's breaks ahead, for "what would play at…" (`in_break` and `next_change_at` of the
 * simulate route): the tick's own step run forward on a copy of the zone's state, so simulate
 * and the tick share one rule and nothing is written.
 */
import { stepBreaks, type BreakInput, type BreakState } from "./breaks.js";

/** A run of breaks with nothing between: chained breaks are one interval. */
export interface BreakInterval {
  startsAt: Date;
  endsAt: Date;
}

const MINUTE_MS = 60_000;
// Every whole minute of a day plus a few edges per break; a bound against a runaway loop only.
const MAX_STEPS = 20_000;

/**
 * The breaks between `from` and `until`, from the zone's stored state. It steps only where
 * something can change: a break's end, a due time, the gap's end, and every whole minute, where
 * a daily window opens or closes (every UTC offset is a whole number of minutes).
 */
export function projectBreaks(
  state: BreakState,
  input: BreakInput,
  from: Date,
  until: Date,
): BreakInterval[] {
  const intervals: BreakInterval[] = [];
  const untilMs = until.getTime();
  let current = state;
  let nowMs = from.getTime();
  let open = null as { startsAt: number; endsAt: number } | null;
  for (let steps = 0; nowMs <= untilMs && steps < MAX_STEPS; steps += 1) {
    const { state: next, playing } = stepBreaks(current, input, nowMs);
    if (playing !== null) {
      open = { startsAt: open?.startsAt ?? playing.startedAt, endsAt: playing.endsAt };
    } else if (open !== null) {
      intervals.push({ startsAt: new Date(open.startsAt), endsAt: new Date(nowMs) });
      open = null;
    }
    current = next;
    nowMs = nextStep(current, input, nowMs, playing?.endsAt ?? null);
  }
  if (open !== null) {
    intervals.push({ startsAt: new Date(open.startsAt), endsAt: new Date(open.endsAt) });
  }
  return intervals;
}

function nextStep(state: BreakState, input: BreakInput, nowMs: number, endsAt: number | null) {
  let soonest = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const consider = (t: number | null) => {
    if (t !== null && t > nowMs && t < soonest) soonest = t;
  };
  consider(endsAt);
  for (const entry of Object.values(state.playlists)) consider(entry.dueAt);
  if (state.chainEndedAt !== null) consider(state.chainEndedAt + input.minGapSeconds * 1000);
  return soonest;
}
