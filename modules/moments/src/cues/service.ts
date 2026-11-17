/**
 * Cues (contracts/moments.md, Cues and sound): a cue's picture for a moment's box, and its sound
 * decided once per zone (decide.ts) and sent to the zone's screens as `moments.sound.played` with
 * `play_at` (D14). Each zone's decision runs under its row lock in the caller's transaction, so the
 * sound and its log line commit with what caused them; the minute and hour counts are Valkey's (D15).
 */
import type { Outbox, SqlClient } from "@canccu/kit";
import { requireTenant } from "@canccu/kit";
import { FADE_SECONDS } from "./catalog.js";
import type { Effect } from "./catalog.js";
import { LEAD_MS, VIDEO_CUE, decide, pickNotLast, pump } from "./decide.js";
import type { Done, Play } from "./decide.js";
import { soundKeys } from "./counters.js";
import type { Counters } from "./counters.js";
import type { ScreenClient, ZoneSoundStatus } from "./screen.js";
import {
  emergencyOn,
  loadCue,
  loadLibrary,
  loadSettings,
  lockZone,
  oncePlayed,
  queuedZones,
  rememberOnce,
  saveZone,
  swapEffect,
  writeLog,
} from "./store.js";
import type { LibrarySound } from "./store.js";
import type { MomentRow } from "../store.js";

export interface CueTrigger {
  cue: string;
  /** Empty: every zone Moments knows. */
  zones: string[];
  /** The appearance (a moment, a photo): it sounds once. */
  key: string;
  source: string | null;
  starts_at?: string | null;
  /** A story's run: its flood source, whatever the cue (fix 7). */
  flood?: string | null;
}

/** What a zone decided, for a story's own cap (SO2). */
export interface ZoneOutcome {
  zone: string;
  outcome: string;
}

export interface Picture {
  name: Effect;
  hold_seconds: number;
  fade_seconds: number;
}

export interface CuesDeps {
  outbox: Outbox;
  counters: Counters;
  screen: ScreenClient;
  random?: () => number;
}

export const SOUND_CHECK = "sound_check";
const CHECK_SOUND = "pack.chime-bright";

export class Cues {
  private readonly random: () => number;

  constructor(private readonly deps: CuesDeps) {
    this.random = deps.random ?? Math.random;
  }

  /** The zone's sounds this minute and this hour, as the decisions count them. */
  async counts(zone: string, at: number): Promise<[number, number]> {
    const [minute, hour] = await this.deps.counters.get([
      soundKeys.minute(zone, at),
      soundKeys.hour(zone, at),
    ]);
    return [minute ?? 0, hour ?? 0];
  }

  /** The effect a moment's box makes, never the cue's last one (L7); null for a sound-only cue. */
  async picture(c: SqlClient, name: string): Promise<Picture | null> {
    const cue = await loadCue(c, name);
    if (cue === null || cue.effects.length === 0) return null;
    const effect = await swapEffect(
      c,
      name,
      (last) => pickNotLast(cue.effects, last as Effect | null, this.random) as Effect,
    );
    return { name: effect as Effect, hold_seconds: cue.hold_seconds, fade_seconds: FADE_SECONDS };
  }

  /** A moment's start sounds its cue once on its zones; its source is what it is about. */
  async started(c: SqlClient, m: MomentRow, cue: string, now: Date): Promise<void> {
    const t = { cue, zones: m.zones, key: `moment:${m.id}`, source: m.source.ref ?? m.id };
    await this.fire(c, t, now);
  }

  /** Decides the cue's sound on each of its zones, in zone order (the row locks' order). */
  async fire(c: SqlClient, t: CueTrigger, now: Date): Promise<ZoneOutcome[]> {
    const out: ZoneOutcome[] = [];
    const cue = await loadCue(c, t.cue);
    const zones = t.zones.length > 0 ? t.zones : await this.knownZones(c);
    const at = now.getTime();
    const base = { at: now, cue: t.cue, source: t.source, sound: null, detail: null };
    if (cue === null) {
      for (const zone of [...zones].sort()) {
        await writeLog(c, {
          ...base,
          zone_key: zone,
          outcome: "suppressed",
          reason: "unknown_cue",
        });
        out.push({ zone, outcome: "suppressed" });
      }
      return out;
    }
    const settings = await loadSettings(c);
    const library = await loadLibrary(c);
    const length = (id: string): number | null =>
      library.find((s) => s.id === id)?.length_ms ?? null;
    for (const zone of [...zones].sort()) {
      const status = await this.status(zone);
      if (status !== null && status.device === null) {
        await writeLog(c, {
          ...base,
          zone_key: zone,
          outcome: "suppressed",
          reason: "no_sound_screen",
        });
        out.push({ zone, outcome: "suppressed" });
        continue;
      }
      const emergency = await emergencyOn(c, zone);
      let state = await this.pumped(c, zone, at, settings, emergency, library);
      const [minute, hour] = await this.deps.counters.get([
        soundKeys.minute(zone, at),
        soundKeys.hour(zone, at),
      ]);
      const once =
        cue.once_per_source &&
        t.source !== null &&
        (await oncePlayed(c, zone, cue.name, t.source, now));
      const d = decide({
        now: at,
        settings,
        cue,
        energy: status?.energy ?? "lively",
        emergency,
        zone: state,
        key: t.key,
        source: t.source,
        starts_at: t.starts_at ?? null,
        flood: t.flood ?? null,
        counts: { minute: minute ?? 0, hour: hour ?? 0, once_played: once },
        length,
        random: this.random,
      });
      state = d.zone;
      await saveZone(c, zone, state);
      if (d.count) {
        await this.deps.counters.incr(soundKeys.minute(zone, at), soundKeys.ttl.minute);
        await this.deps.counters.incr(soundKeys.hour(zone, at), soundKeys.ttl.hour);
      }
      if (d.once && t.source !== null) await rememberOnce(c, zone, cue.name, t.source, now);
      const missed = d.play === undefined ? null : missedOn(status, d.play);
      await writeLog(c, {
        ...base,
        zone_key: zone,
        sound: d.play?.sound ?? null,
        outcome: missed === null ? d.outcome : "missed",
        reason: missed?.reason ?? d.reason,
        detail: missed?.detail ?? d.detail ?? null,
      });
      if (d.play !== undefined) await this.send(c, zone, d.play, library);
      out.push({ zone, outcome: d.outcome });
    }
    return out;
  }

  /**
   * A story's video sound (contracts/moments.md, The video step): counted as one sound in the
   * minute and the hour but never refused by them, muted where the zone's sound is off, muted or
   * its energy is calm or quiet; while it plays every other non-urgent sound there is held.
   * Answers the zones where the video plays muted.
   */
  async video(
    c: SqlClient,
    zones: string[],
    untilMs: number,
    source: string,
    now: Date,
  ): Promise<string[]> {
    const settings = await loadSettings(c);
    const at = now.getTime();
    const muted: string[] = [];
    for (const zone of [...(zones.length > 0 ? zones : await this.knownZones(c))].sort()) {
      const status = await this.status(zone);
      const off = !settings.enabled
        ? "master_off"
        : settings.muted_until !== null && Date.parse(settings.muted_until) > at
          ? "muted"
          : status !== null && status.device === null
            ? "no_sound_screen"
            : status?.energy === "calm" || status?.energy === "quiet"
              ? status.energy
              : null;
      const log = { at: now, zone_key: zone, cue: VIDEO_CUE, sound: null, source, detail: null };
      if (off !== null) {
        muted.push(zone);
        await writeLog(c, { ...log, outcome: "suppressed", reason: off });
        continue;
      }
      await this.deps.counters.incr(soundKeys.minute(zone, at), soundKeys.ttl.minute);
      await this.deps.counters.incr(soundKeys.hour(zone, at), soundKeys.ttl.hour);
      const state = await lockZone(c, zone);
      await saveZone(c, zone, {
        ...state,
        playing: {
          id: `video_${source}`,
          cue: VIDEO_CUE,
          category: "attention",
          until_ms: untilMs,
        },
      });
      await writeLog(c, { ...log, outcome: "played", reason: "free" });
    }
    return muted;
  }

  /** A story step that does not sound on a zone: hidden there, or over the story's cap (SO2). */
  async skipped(
    c: SqlClient,
    zone: string,
    cue: string,
    source: string,
    reason: "hidden" | "story_cap",
    now: Date,
  ) {
    await writeLog(c, {
      at: now,
      zone_key: zone,
      cue,
      sound: null,
      source,
      outcome: "suppressed",
      reason,
      detail: null,
    });
  }

  /** The zone's energy as Screen says it, or null when Screen does not answer. */
  async energy(zone: string): Promise<string | null> {
    return (await this.status(zone))?.energy ?? null;
  }

  /** The tick: each zone with a sound waiting plays it or lets it go (stale, emergency). */
  async pumpAll(c: SqlClient, now: Date): Promise<void> {
    const zones = await queuedZones(c);
    if (zones.length === 0) return;
    const settings = await loadSettings(c);
    const library = await loadLibrary(c);
    for (const zone of zones) {
      const state = await this.pumped(
        c,
        zone,
        now.getTime(),
        settings,
        await emergencyOn(c, zone),
        library,
      );
      await saveZone(c, zone, state);
    }
  }

  /**
   * The sound desk's check: a sound on the chosen zones now, past every gate but the master
   * switch, interrupting what plays; it counts in no budget.
   */
  async check(c: SqlClient, zones: string[], sound: string | null, now: Date): Promise<void> {
    const settings = await loadSettings(c);
    const library = await loadLibrary(c);
    const id = sound ?? CHECK_SOUND;
    const file = library.find((s) => s.id === id);
    const at = now.getTime();
    for (const zone of [...(zones.length > 0 ? zones : await this.knownZones(c))].sort()) {
      const log = { at: now, zone_key: zone, cue: SOUND_CHECK, sound: id, source: null };
      if (!settings.enabled || file === undefined) {
        const reason = file === undefined ? "no_sound" : "master_off";
        await writeLog(c, { ...log, outcome: "suppressed", reason, detail: null });
        continue;
      }
      const state = await lockZone(c, zone);
      const play: Play = {
        id: `snd_${String(at)}_check_${Math.floor(this.random() * 1e9).toString(36)}`,
        cue: SOUND_CHECK,
        category: "urgent",
        sound: id,
        voice: null,
        volume: settings.volume / 100,
        play_at: new Date(at + LEAD_MS).toISOString(),
        catch_up_until: new Date(at + LEAD_MS + 10_000).toISOString(),
        interrupts: true,
        length_ms: file.length_ms,
      };
      await saveZone(c, zone, {
        ...state,
        playing: {
          id: play.id,
          cue: SOUND_CHECK,
          category: "urgent",
          until_ms: at + LEAD_MS + file.length_ms,
        },
      });
      const missed = missedOn(await this.status(zone), play);
      await writeLog(c, {
        ...log,
        outcome: missed === null ? "played" : "missed",
        reason: missed?.reason ?? "sound_check",
        detail: missed?.detail ?? null,
      });
      await this.send(c, zone, play, library);
    }
  }

  private async pumped(
    c: SqlClient,
    zone: string,
    at: number,
    settings: Awaited<ReturnType<typeof loadSettings>>,
    emergency: boolean,
    library: LibrarySound[],
  ) {
    const p = pump(await lockZone(c, zone), at, settings, emergency);
    for (const d of p.done) await this.resolved(c, zone, d, new Date(at), library);
    return p.zone;
  }

  private async resolved(c: SqlClient, zone: string, d: Done, at: Date, library: LibrarySound[]) {
    await writeLog(c, {
      at,
      zone_key: zone,
      cue: d.cue,
      sound: d.play?.sound ?? null,
      outcome: d.outcome,
      reason: d.reason,
      detail: d.detail ?? null,
      source: d.source,
    });
    if (d.play !== undefined) await this.send(c, zone, d.play, library);
  }

  private async send(c: SqlClient, zone: string, p: Play, library: LibrarySound[]) {
    const url = (id: string | null) =>
      id === null ? null : (library.find((s) => s.id === id)?.url ?? null);
    await this.deps.outbox.add(
      c,
      "moments.sound.played",
      {
        zone_key: zone,
        sound: {
          id: p.id,
          cue: p.cue,
          category: p.category,
          url: url(p.sound),
          voice_url: url(p.voice),
          volume: p.volume,
          play_at: p.play_at,
          catch_up_until: p.catch_up_until,
          interrupts: p.interrupts,
        },
      },
      { version: 1 },
    );
  }

  private async status(zone: string): Promise<ZoneSoundStatus | null> {
    return this.deps.screen.zoneSound(requireTenant(), zone);
  }

  private async knownZones(c: SqlClient): Promise<string[]> {
    const { rows } = await c.query(`SELECT zone_key FROM moments_zones ORDER BY zone_key`, []);
    return rows.map((r) => r.zone_key as string);
  }
}

/** E12, E13: a sound screen that cannot play now; the sound stays sent for its catch-up. */
function missedOn(
  status: ZoneSoundStatus | null,
  p: Play,
): { reason: string; detail: string } | null {
  const device = status?.device;
  if (device == null) return null;
  const detail = `catch-up until ${p.catch_up_until.slice(11, 19)} UTC`;
  if (!device.online) return { reason: "device_offline", detail };
  if (device.audio_unlocked === false) return { reason: "audio_locked", detail };
  return null;
}
