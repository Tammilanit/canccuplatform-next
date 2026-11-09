/**
 * "What would play at…" (`GET /api/screen/schedules/simulate`, the `Simulation` schema): the
 * winner for one zone at any time, and when it next changes. Pure, like the tick it mirrors:
 * reading never writes (the step 3 brief: the legacy's reads that wrote were its worst flaw).
 * The legacy scanned for the next change minute by minute too (`findNextScheduleTransition`).
 */
import { isAgendaWindow, resolveWinner, type SchedulerInput } from "./winner.js";

/** As far ahead as the screens prefetch (`prefetch` in ScreenState). */
export const NEXT_CHANGE_HORIZON_MS = 24 * 60 * 60 * 1000;

export interface SimulateInput extends SchedulerInput {
  zoneKey: string;
  /** The zone's own layout, shown whenever the winner names none. */
  zoneLayoutId: string;
  /** Whether a break interrupts the zone at that time; breaks are a later slice's. */
  inBreak?: (at: Date) => boolean;
}

export interface Simulation {
  at: string;
  zone_key: string;
  schedule_id: string | null;
  playlist_id: string | null;
  layout_id: string;
  in_break: boolean;
  next_change_at: string | null;
}

export function simulate(input: SimulateInput, at: Date): Simulation {
  const zoneInput = { ...input, windows: input.windows.filter((w) => w.zoneKey === input.zoneKey) };
  const winner = resolveWinner(zoneInput, at);
  return {
    at: at.toISOString(),
    zone_key: input.zoneKey,
    schedule_id: winner?.id ?? null,
    playlist_id: winner?.playlistId ?? null,
    layout_id: winner?.layoutId ?? input.zoneLayoutId,
    in_break: input.inBreak?.(at) ?? false,
    next_change_at: nextChange(zoneInput, at)?.toISOString() ?? null,
  };
}

/**
 * The first instant in (at, at + horizon] at which the winner differs from the one at `at`.
 * Weekly windows change only on whole minutes; walking real minutes, not wall-clock ones, keeps
 * daylight-saving switches right without special cases. Bound windows change at their items'
 * exact times, which need not fall on a minute.
 */
export function nextChange(input: SchedulerInput, at: Date): Date | null {
  const fromMs = at.getTime();
  const toMs = fromMs + NEXT_CHANGE_HORIZON_MS;
  const candidates = new Set<number>();
  for (let t = Math.floor(fromMs / 60_000) * 60_000 + 60_000; t <= toMs; t += 60_000) {
    candidates.add(t);
  }
  for (const window of input.windows) {
    if (!isAgendaWindow(window)) continue;
    const item = input.agendaItems?.get(window.agendaItemId);
    for (const edge of [item?.startsAt, item?.endsAt]) {
      const t = edge?.getTime();
      if (t !== undefined && t > fromMs && t <= toMs) candidates.add(t);
    }
  }
  const before = resolveWinner(input, at)?.id ?? null;
  for (const t of [...candidates].sort((a, b) => a - b)) {
    const when = new Date(t);
    if ((resolveWinner(input, when)?.id ?? null) !== before) return when;
  }
  return null;
}
