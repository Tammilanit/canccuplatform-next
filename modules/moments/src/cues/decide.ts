/**
 * Whether a cue sounds on one zone, and when: the legacy sound engine (canccusignage
 * src/lib/sound/engine.ts) moved to the server, one decision per zone for every screen of it
 * (step 4 plan, The sound model D16; mockup 13). Pure: the store keeps the zone's state, the
 * Valkey counters give the flood and budget counts (D15), the caller pumps the queue before
 * deciding. Changed from the legacy: only urgent interrupts, a queued sound waits at most 4 s from
 * its request, 3 a minute and an hourly budget per zone, calm and quiet let fewer categories through.
 */
import { CALM, PRIORITY } from "./catalog.js";
import type { Category, Cue, SoundSettings } from "./catalog.js";

/** `play_at` is this far ahead, so every screen of the zone gets the decision first (D14). */
export const LEAD_MS = 400;
export const QUEUE_STALE_MS = 4000;
export const COALESCE_MS = 2000;
export const AMBIENT_GAP_MS = 30_000;
/** Appearances are remembered this long: events reach every container, so they come twice. */
const SEEN_MS = 3_600_000;

export type Energy = "party" | "lively" | "calm" | "quiet";

export type Outcome = "played" | "queued" | "suppressed" | "dropped";

/** Every reason the log gives (contracts/moments.md, The sound log). */
export type Reason =
  | "free"
  | "waited"
  | "interrupted"
  | "urgent_passes"
  | "master_off"
  | "muted"
  | "quiet"
  | "calm"
  | "category_off"
  | "cue_off"
  | "no_sound"
  | "cooldown"
  | "emergency"
  | "dedupe"
  | "once_per_source"
  | "outside_window"
  | "coalesced"
  | "flood_source"
  | "flood_minute"
  | "budget"
  | "ambient_gap"
  | "busy"
  | "stale"
  | "video"
  | "hidden"
  | "story_cap";

/** The cue name a story's video plays its own sound under (contracts/moments.md, The video step). */
export const VIDEO_CUE = "story.video";

/** One decided sound, as the zone's screens get it (without the files' URLs). */
export interface Play {
  id: string;
  cue: string;
  category: Category;
  sound: string;
  voice: string | null;
  volume: number;
  play_at: string;
  catch_up_until: string;
  interrupts: boolean;
  length_ms: number;
}

interface Queued {
  play: Play;
  key: string;
  source: string | null;
  requested_ms: number;
  catch_up_ms: number;
}

export interface ZoneSound {
  playing: { id: string; cue: string; category: Category; until_ms: number } | null;
  queue: Queued[];
  /** By cue: its last start here (cooldown) and its last acceptance (coalescing). */
  played_ms: Record<string, number>;
  accepted_ms: Record<string, number>;
  last_ambient_ms: number;
  /** By cue: the sound it last played here, never picked twice running. */
  last_sound: Record<string, string>;
  seen: Record<string, number>;
  /** By cue and source: when it was last accepted here, for the flood guard's 10 s per source. */
  sources: Record<string, number>;
}

export const EMPTY_ZONE: ZoneSound = {
  playing: null,
  queue: [],
  played_ms: {},
  accepted_ms: {},
  last_ambient_ms: 0,
  last_sound: {},
  seen: {},
  sources: {},
};

export interface Counts {
  minute: number;
  hour: number;
  /** A once-per-source cue already sounded for this source here (7 days). */
  once_played: boolean;
}

export interface DecideInput {
  now: number;
  settings: SoundSettings;
  cue: Cue;
  energy: Energy;
  emergency: boolean;
  zone: ZoneSound;
  /** The appearance: the same key never sounds twice. */
  key: string;
  source: string | null;
  /** The source's start, for a cue with a window before the start. */
  starts_at: string | null;
  /** The flood guard's source instead of the cue and source: a story's run (fix 7). */
  flood?: string | null;
  counts: Counts;
  /** A library sound's length, or null when it is gone. */
  length: (sound: string) => number | null;
  random: () => number;
}

export interface Decision {
  outcome: Outcome;
  reason: Reason;
  detail?: string;
  zone: ZoneSound;
  play?: Play;
  /** Count it in the minute, the hour and the source's window. */
  count: boolean;
  /** Remember the source for a once-per-source cue. */
  once: boolean;
  lead_ms: number;
}

/** One of `items` at random, never `last` while another is left. */
export function pickNotLast<T>(
  items: readonly T[],
  last: T | null,
  random: () => number,
): T | null {
  if (items.length === 0) return null;
  const rest = items.length > 1 ? items.filter((i) => i !== last) : items;
  return rest[Math.min(rest.length - 1, Math.floor(random() * rest.length))] ?? null;
}

const ago = (ms: number): string =>
  ms < 60_000 ? `${String(Math.round(ms / 1000))} s` : `${String(Math.round(ms / 60_000))} min`;

const volumeOf = (s: SoundSettings, cue: Cue): number =>
  Math.round(s.volume * s.categories[cue.category].level * cue.level) / 1_000_000;

export function decide(i: DecideInput): Decision {
  const { now, cue, settings: s } = i;
  const no = (reason: Reason, detail?: string, zone = i.zone): Decision => ({
    outcome: "suppressed",
    reason,
    ...(detail === undefined ? {} : { detail }),
    zone,
    count: false,
    once: false,
    lead_ms: LEAD_MS,
  });
  const urgent = cue.category === "urgent";
  if (!s.enabled) return no("master_off");
  if (s.muted_until !== null && Date.parse(s.muted_until) > now) return no("muted");
  if (i.energy === "quiet" && !urgent) return no("quiet", `${cue.category} does not play`);
  if (i.energy === "calm" && !CALM.has(cue.category))
    return no("calm", `${cue.category} does not play`);
  if (!s.categories[cue.category].enabled) return no("category_off");
  if (!cue.enabled) return no("cue_off");
  const sounds = cue.sounds.filter((x) => i.length(x) !== null);
  if (sounds.length === 0) return no("no_sound");
  const last = i.zone.played_ms[cue.name];
  if (cue.cooldown_seconds > 0 && last !== undefined && now - last < cue.cooldown_seconds * 1000) {
    return no(
      "cooldown",
      `sounded ${ago(now - last)} ago (waits ${ago(cue.cooldown_seconds * 1000)})`,
    );
  }
  // Still waiting, it starts soon: a second one would play right after it, inside the cooldown.
  if (cue.cooldown_seconds > 0 && i.zone.queue.some((q) => q.play.cue === cue.name))
    return no("cooldown", "one waits in the queue");
  if (i.emergency && !urgent) return no("emergency");
  const held = i.zone.playing !== null && now < i.zone.playing.until_ms ? i.zone.playing : null;
  if (held?.cue === VIDEO_CUE && !urgent) return no("video", "held while a video plays");
  const seen = Object.fromEntries(
    Object.entries(i.zone.seen).filter(([, at]) => now - at < SEEN_MS),
  );
  if (seen[i.key] !== undefined) return no("dedupe");
  if (cue.once_per_source && i.counts.once_played) return no("once_per_source", i.source ?? "");
  let catchUpMs = now + LEAD_MS + cue.catch_up_seconds * 1000;
  if (cue.catch_up_before_start !== null && i.starts_at !== null) {
    const start = Date.parse(i.starts_at);
    const [from, to] = cue.catch_up_before_start;
    if (now < start - from * 60_000 || now >= start - to * 60_000) {
      return no("outside_window", `T−${String(from)} to T−${String(to)} min`);
    }
    catchUpMs = start - to * 60_000;
  }
  const accepted = i.zone.accepted_ms[cue.name];
  if (accepted !== undefined && now - accepted < COALESCE_MS) {
    return no("coalesced", undefined, { ...i.zone, seen: { ...seen, [i.key]: now } });
  }
  let passes: Reason | null = null;
  const window = s.per_source_seconds * 1000;
  const sources = Object.fromEntries(
    Object.entries(i.zone.sources).filter(([, at]) => now - at < window),
  );
  const sourceKey = i.flood ?? `${cue.name}|${i.source ?? ""}`;
  if ((i.source !== null || i.flood != null) && sources[sourceKey] !== undefined) {
    if (!urgent) return no("flood_source", `${String(s.per_source_seconds)} s per source`);
    passes = "urgent_passes";
  }
  if (i.counts.minute >= s.per_minute) {
    if (!urgent) return no("flood_minute", `${String(i.counts.minute)} this minute`);
    passes = "urgent_passes";
  }
  if (i.counts.hour >= s.hourly_budget) {
    if (!urgent) return no("budget", `${String(i.counts.hour)} / ${String(s.hourly_budget)}`);
    passes = "urgent_passes";
  }
  const playing = i.zone.playing !== null && now < i.zone.playing.until_ms ? i.zone.playing : null;
  if (cue.category === "ambient") {
    if (now - i.zone.last_ambient_ms < AMBIENT_GAP_MS) return no("ambient_gap");
    if (playing !== null || i.zone.queue.length > 0) return no("busy", playing?.cue);
  }
  const sound = pickNotLast(sounds, i.zone.last_sound[cue.name] ?? null, i.random) as string;
  const voice =
    cue.voice_line !== null && i.length(cue.voice_line) !== null ? cue.voice_line : null;
  const play: Play = {
    id: `snd_${String(now)}_${cue.name}_${Math.floor(i.random() * 1e9).toString(36)}`,
    cue: cue.name,
    category: cue.category,
    sound,
    voice,
    volume: volumeOf(s, cue),
    play_at: new Date(now + LEAD_MS).toISOString(),
    catch_up_until: new Date(catchUpMs).toISOString(),
    interrupts: false,
    length_ms: (i.length(sound) ?? 0) + (voice === null ? 0 : (i.length(voice) ?? 0)),
  };
  const zone: ZoneSound = {
    ...i.zone,
    seen: { ...seen, [i.key]: now },
    accepted_ms: { ...i.zone.accepted_ms, [cue.name]: now },
    last_sound: { ...i.zone.last_sound, [cue.name]: sound },
    sources: i.source === null && i.flood == null ? sources : { ...sources, [sourceKey]: now },
  };
  const accept = { count: true, once: cue.once_per_source, lead_ms: LEAD_MS };
  if (playing !== null && !(urgent && playing.category !== "urgent")) {
    zone.queue = [
      ...i.zone.queue,
      { play, key: i.key, source: i.source, requested_ms: now, catch_up_ms: catchUpMs },
    ];
    return {
      outcome: "queued",
      reason: "waited",
      detail: `${playing.cue} playing`,
      zone,
      ...accept,
    };
  }
  const reason: Reason = playing !== null ? "interrupted" : (passes ?? "free");
  const started = start(zone, { ...play, interrupts: playing !== null }, now);
  return {
    outcome: "played",
    reason,
    ...(playing === null ? {} : { detail: `urgent interrupts ${playing.cue}` }),
    zone: started.zone,
    play: started.play,
    ...accept,
  };
}

function start(zone: ZoneSound, play: Play, now: number): { zone: ZoneSound; play: Play } {
  const at = now + LEAD_MS;
  const timed = { ...play, play_at: new Date(at).toISOString() };
  return {
    play: timed,
    zone: {
      ...zone,
      playing: {
        id: play.id,
        cue: play.cue,
        category: play.category,
        until_ms: at + play.length_ms,
      },
      played_ms: { ...zone.played_ms, [play.cue]: now },
      last_ambient_ms: play.category === "ambient" ? now : zone.last_ambient_ms,
    },
  };
}

export interface Done {
  cue: string;
  key: string;
  source: string | null;
  outcome: "played" | "dropped";
  reason: Reason;
  detail?: string;
  play?: Play;
}

/**
 * The queue at `now`: a sound past 4 s from its request drops as stale, a non-urgent one drops
 * while an emergency runs, and on a free zone the highest category starts (the earliest first).
 */
export function pump(
  zone: ZoneSound,
  now: number,
  _settings: SoundSettings,
  emergency: boolean,
): { zone: ZoneSound; done: Done[] } {
  const done: Done[] = [];
  const kept: Queued[] = [];
  for (const q of zone.queue) {
    const base = { cue: q.play.cue, key: q.key, source: q.source, outcome: "dropped" as const };
    if (emergency && q.play.category !== "urgent") done.push({ ...base, reason: "emergency" });
    else if (now - q.requested_ms > QUEUE_STALE_MS)
      done.push({
        ...base,
        reason: "stale",
        detail: `${String(QUEUE_STALE_MS / 1000)} s in the queue`,
      });
    else kept.push(q);
  }
  let next: ZoneSound = { ...zone, queue: kept };
  const busy = next.playing !== null && now < next.playing.until_ms;
  if (!busy && kept.length > 0) {
    const first = [...kept].sort(
      (a, b) =>
        PRIORITY[b.play.category] - PRIORITY[a.play.category] || a.requested_ms - b.requested_ms,
    )[0] as Queued;
    next = { ...next, queue: kept.filter((q) => q !== first) };
    const started = start(
      next,
      { ...first.play, catch_up_until: new Date(first.catch_up_ms).toISOString() },
      now,
    );
    next = started.zone;
    done.push({
      cue: first.play.cue,
      key: first.key,
      source: first.source,
      outcome: "played",
      reason: "waited",
      detail: `waited ${((now - first.requested_ms) / 1000).toFixed(1)} s`,
      play: started.play,
    });
  }
  return { zone: next, done };
}
