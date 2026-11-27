/**
 * What an airtime pass (air.ts) adds to a plan's slots: a condensed round's steps (rule 6), and the
 * history's line for a moment that stepped down from the hero (#787 D7).
 */
import type { SqlClient } from "@canccu/kit";
import type { SlotOut } from "./air-plan.js";
import type { AirSettings } from "./air-settings.js";
import { titleOf, writeHistory } from "./store.js";
import type { MomentRow } from "./store.js";

const STEP_MIN_MS = 8000;
const STEP_MAX_MS = 60_000;

export /** A condensed round's steps (rule 6): the holder and the moments inside it, in queue order. */
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

/** "Stepped down" to the first region of the rest of its chain, in the zone's history. */
export async function noteStepDown(
  c: SqlClient,
  zone: string,
  m: MomentRow,
  out: SlotOut,
  now: Date,
): Promise<void> {
  await writeHistory(c, {
    at: now,
    zone_key: zone,
    action: "stepped_down",
    moment_id: m.id,
    class: m.class,
    origin: m.origin,
    title: titleOf(m),
    region: out.regions?.[0] ?? null,
    why: m.why,
  });
}
