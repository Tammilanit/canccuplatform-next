/**
 * The hype curve (#787 D12, D13; contracts/moments.md, The hype): how near a zone is to its next
 * big item, 0 to 1, with its phase. Big is a public, scheduled `tournament` or `ceremony` of the
 * zone or of no zone, the kinds tonight's highlight and the day's peak already use; a final is a
 * tournament item on the agenda (contracts/agenda.md), so it counts with no source of its own.
 * Pure: the clock and the items come in. contracts/moments/hype.json is shared with Screen.
 */
import type { AgendaItem } from "./scene-eval.js";

export type HypePhase = "quiet" | "building" | "live" | "after";

export interface HypeItem {
  id: string;
  title: string | null;
  kind: string;
  starts_at: string;
  ends_at: string | null;
}

export interface Hype {
  level: number;
  phase: HypePhase;
  item: HypeItem | null;
}

const MIN = 60_000;
const BUILD_MS = 60 * MIN;
const FALL_MS = 20 * MIN;
/** The band rule's least time between two bands, so a screen never flickers between levels. */
export const BAND_MS = 5 * MIN;
/** Where Screen's level steps up: calm below the first, lively below the second, party above. */
export const HYPE_BANDS = [0.35, 0.7] as const;
const BIG = new Set(["tournament", "ceremony"]);

/** Steps of 0.05: a finer level would send the zone's scene again every few seconds. */
const stepped = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 20) / 20;

/** As the day's phase reads an item: one without an end runs an hour. */
const endOf = (i: AgendaItem): number =>
  i.ends_at !== null ? Date.parse(i.ends_at) : Date.parse(i.starts_at) + 60 * MIN;

const itemOf = (i: AgendaItem): HypeItem => ({
  id: i.id,
  title: typeof i.title === "string" ? i.title : null,
  kind: i.kind,
  starts_at: i.starts_at,
  ends_at: i.ends_at,
});

export function hypeOf(items: readonly AgendaItem[], zone: string, now: number): Hype {
  const big = items
    .filter(
      (i) =>
        BIG.has(i.kind) &&
        i.visibility === "public" &&
        (i.status ?? "scheduled") === "scheduled" &&
        (i.zone == null || i.zone === zone),
    )
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const live = big.find((i) => Date.parse(i.starts_at) <= now && now < endOf(i));
  if (live !== undefined) return { level: 1, phase: "live", item: itemOf(live) };
  const next = big.find((i) => Date.parse(i.starts_at) > now);
  const lead = next === undefined ? Infinity : Date.parse(next.starts_at) - now;
  const building = lead <= BUILD_MS ? 1 - lead / BUILD_MS : null;
  const ended = big
    .filter((i) => endOf(i) <= now && now - endOf(i) < FALL_MS)
    .sort((a, b) => endOf(b) - endOf(a))[0];
  const falling = ended === undefined ? null : 1 - (now - endOf(ended)) / FALL_MS;
  // Building towards the next while still falling from the last: the louder of the two.
  if (ended !== undefined && falling !== null && (building === null || falling > building))
    return { level: stepped(falling), phase: "after", item: itemOf(ended) };
  if (next !== undefined && building !== null)
    return { level: stepped(building), phase: "building", item: itemOf(next) };
  return { level: 0, phase: "quiet", item: next === undefined ? null : itemOf(next) };
}

const bandOf = (level: number): number => HYPE_BANDS.filter((b) => level >= b).length;

export interface SentHype {
  hype: Hype;
  /** When the hype last moved into its band (ms). */
  band_since: number;
}

/**
 * The band rule (D13): a hype that moves into another band than the one last sent waits at the
 * old band's edge until that band has held 5 minutes, so the level a screen draws changes at most
 * once in 5 minutes. Within a band it moves at once.
 */
export function heldHype(prev: SentHype | null, next: Hype, now: number): SentHype {
  if (prev === null) return { hype: next, band_since: now };
  const was = bandOf(prev.hype.level);
  const band = bandOf(next.level);
  if (band === was) return { hype: next, band_since: prev.band_since };
  if (now - prev.band_since >= BAND_MS) return { hype: next, band_since: now };
  const low = was === 0 ? 0 : HYPE_BANDS[was - 1];
  const high = was === HYPE_BANDS.length ? 1 : stepped((HYPE_BANDS[was] ?? 1) - 0.05);
  const edge = band > was ? high : low;
  return { hype: { ...next, level: edge ?? 0 }, band_since: prev.band_since };
}
