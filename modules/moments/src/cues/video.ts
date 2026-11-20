/**
 * A story's video sound (contracts/moments.md, The video step): counted as one sound in the
 * minute and the hour but never refused by them, muted where the zone's sound is off, muted or
 * its energy is calm or quiet; while it plays every other non-urgent sound there is held. Planned
 * before the video's moment is asked for (its content names the muted zones) and started only
 * once it is: a refused video holds and counts nothing (#605).
 */
import type { SqlClient } from "@canccu/kit";
import { requireTenant } from "@canccu/kit";
import { soundKeys } from "./counters.js";
import type { Counters } from "./counters.js";
import { VIDEO_CUE } from "./decide.js";
import type { ScreenClient } from "./screen.js";
import { loadSettings, lockZone, saveZone, writeLog } from "./store.js";
import { knownZones } from "../store.js";

/** Each zone of a video, and why it plays muted there (a log reason), or null where it sounds. */
export type VideoPlan = { zone: string; off: string | null }[];

export async function planVideo(
  c: SqlClient,
  screen: ScreenClient,
  zones: string[],
  now: Date,
): Promise<VideoPlan> {
  const settings = await loadSettings(c);
  const at = now.getTime();
  const plan: VideoPlan = [];
  for (const zone of [...(zones.length > 0 ? zones : await knownZones(c))].sort()) {
    const status = await screen.zoneSound(requireTenant(), zone);
    const off = !settings.enabled
      ? "master_off"
      : settings.muted_until !== null && Date.parse(settings.muted_until) > at
        ? "muted"
        : status !== null && status.device === null
          ? "no_sound_screen"
          : status?.energy === "calm" || status?.energy === "quiet"
            ? status.energy
            : null;
    plan.push({ zone, off });
  }
  return plan;
}

const holdId = (source: string) => `video_${source}`;

/** The video's moment started: each zone's log, and its count and hold where it sounds. */
export async function startVideo(
  c: SqlClient,
  counters: Counters,
  plan: VideoPlan,
  untilMs: number,
  source: string,
  now: Date,
): Promise<void> {
  const at = now.getTime();
  for (const { zone, off } of plan) {
    const log = { at: now, zone_key: zone, cue: VIDEO_CUE, sound: null, source, detail: null };
    if (off !== null) {
      await writeLog(c, { ...log, outcome: "suppressed", reason: off });
      continue;
    }
    // Uncounted while Valkey does not answer: the video plays on (#592).
    await counters.incr(soundKeys.minute(zone, at), soundKeys.ttl.minute).catch(() => 0);
    await counters.incr(soundKeys.hour(zone, at), soundKeys.ttl.hour).catch(() => 0);
    const state = await lockZone(c, zone);
    await saveZone(c, zone, {
      ...state,
      playing: { id: holdId(source), cue: VIDEO_CUE, category: "attention", until_ms: untilMs },
    });
    await writeLog(c, { ...log, outcome: "played", reason: "free" });
  }
}

/** A paused video resumed: its hold on each zone ends where the video now ends. */
export async function moveVideo(
  c: SqlClient,
  zones: string[],
  untilMs: number,
  source: string,
): Promise<void> {
  // In zone order, as every sound decision takes the zones' row locks.
  for (const zone of [...(zones.length > 0 ? zones : await knownZones(c))].sort()) {
    const state = await lockZone(c, zone);
    if (state.playing?.id !== holdId(source)) continue;
    await saveZone(c, zone, { ...state, playing: { ...state.playing, until_ms: untilMs } });
  }
}
