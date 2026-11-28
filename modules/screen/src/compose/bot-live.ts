/**
 * The bot's live counts for `voice_rooms` and `now_playing` (contracts/screen.md, Widgets; the bot's
 * module paths, contracts/bot.md, For the screens): counts only, never who, so none of this is
 * presence data (contracts/tenants.md, Privacy and retention). Kept in Valkey per event, so every
 * container and a restart draw the same rooms and arrows.
 */
import { tenantKey, withTenant } from "@canccu/kit";
import type { Kv } from "../kv.js";
import type { BotPlaying, BotVoice, Sources } from "./sources.js";
import { trendOf } from "./stats.js";

/** A count older than this many intervals no longer says who is in voice now. */
const LIVE_INTERVALS = 3;
/** The bot is read at most this often per event, however many zones and containers build. */
export const BOT_REREAD_MS = 30_000;
/**
 * A kept answer older than this is read again at the next build even without a count: a stopped
 * bot sends none, and its last answer must not stay on the screens.
 */
const BOT_KEEP_MS = 2 * 60_000;
const ANSWER_KEEP_MS = 5 * 60_000;
const KEPT_TTL_MS = 10 * 60_000;
/** The arrows' 20 minutes, with room for the reads' own spacing. */
const HISTORY_MS = 25 * 60_000;
const MAX_ROOMS = 6;
const MAX_GAMES = 3;

export interface VoiceRoom {
  name: string;
  member_count: number;
}
export interface VoiceCount {
  at: number;
  interval_seconds: number;
  rooms: VoiceRoom[];
}

const voiceKey = (): string => tenantKey("screen", "voice", "counted");
const voiceReadKey = (): string => tenantKey("screen", "voice", "read");
const playingReadKey = (): string => tenantKey("screen", "playing", "read");
const playingStaleKey = (): string => tenantKey("screen", "playing", "stale");
const playingHistoryKey = (): string => tenantKey("screen", "playing", "counts");

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function roomsOf(list: unknown): VoiceRoom[] | null {
  if (!Array.isArray(list)) return null;
  const rooms = list.map((r: unknown) => {
    const { name, member_count } = (r ?? {}) as Record<string, unknown>;
    return typeof name === "string" && isCount(member_count) ? { name, member_count } : null;
  });
  return rooms.every((r) => r !== null) ? rooms : null;
}

/** A `bot.voice.counted` payload as rooms by name and count, or null when it is not one. */
export function voiceOf(data: Record<string, unknown>): VoiceCount | null {
  const at = typeof data.counted_at === "string" ? Date.parse(data.counted_at) : NaN;
  const rooms = roomsOf(data.rooms);
  if (!Number.isFinite(at) || !isCount(data.interval_seconds) || rooms === null) return null;
  return { at, interval_seconds: data.interval_seconds, rooms };
}

/** Keep the latest count; every container hears the event and writes the same value. */
export async function keepVoice(kv: Kv, tenant: string, c: VoiceCount): Promise<void> {
  const liveMs = LIVE_INTERVALS * c.interval_seconds * 1000;
  await withTenant(tenant, () => kv.set(voiceKey(), JSON.stringify(c), liveMs));
}

/** The `voice_rooms` view-model: at most six rooms, busiest first; null with none. */
export function voiceView(rooms: readonly VoiceRoom[]): Record<string, unknown> | null {
  if (rooms.length === 0) return null;
  const sorted = [...rooms].sort((a, b) => b.member_count - a.member_count);
  return { rooms: sorted.slice(0, MAX_ROOMS).map(({ name, member_count }) => ({ name, member_count })) }; // prettier-ignore
}

interface Kept<T> {
  answer: T | null;
  /** The last read, answered or not: the 30 s count from it. */
  read_at: number;
  /** The last read the bot answered: its answer is drawn for at most 5 minutes after. */
  answered_at: number;
}

/**
 * The bot's answer as kept for the event, read again when `due` says so but never sooner than
 * 30 s after the last read, answered or not. A failed read keeps what was read before, drawn at
 * most 5 minutes past its own read, so a bot that stays unreachable leaves the box empty.
 * `fresh`: this call read the bot.
 */
async function keptRead<T>(
  kv: Kv,
  key: string,
  read: () => Promise<T | null>,
  due: (kept: Kept<T>) => boolean,
  nowMs: number,
): Promise<{ answer: T | null; fresh: boolean }> {
  const raw = await kv.get(key);
  let kept = raw === null ? null : (JSON.parse(raw) as Kept<T>);
  const fresh = kept === null || (nowMs - kept.read_at >= BOT_REREAD_MS && due(kept));
  if (fresh) {
    const answer = await read();
    kept =
      answer === null
        ? { answer: kept?.answer ?? null, read_at: nowMs, answered_at: kept?.answered_at ?? 0 }
        : { answer, read_at: nowMs, answered_at: nowMs };
    await kv.set(key, JSON.stringify(kept), KEPT_TTL_MS);
  }
  if (kept === null || nowMs - kept.answered_at > ANSWER_KEEP_MS) return { answer: null, fresh };
  return { answer: kept.answer, fresh: fresh && kept.answered_at === nowMs };
}

/**
 * The `voice_rooms` view-model at `nowMs`, read in the event's tenant context: the latest
 * `bot.voice.counted` while it is live, else the bot's module read (after a restart, before the
 * first minute's count, or once the counts stopped). `changesAt`: when the kept count stops being
 * live, so the zone is built again and falls back then.
 */
export async function readVoice(
  kv: Kv,
  sources: Sources,
  tenant: string,
  nowMs: number,
): Promise<{ view: Record<string, unknown> | null; changesAt: number | null }> {
  const raw = await kv.get(voiceKey());
  const counted = raw === null ? null : (JSON.parse(raw) as VoiceCount);
  const until =
    counted === null ? 0 : counted.at + LIVE_INTERVALS * counted.interval_seconds * 1000;
  if (counted !== null && nowMs <= until) return { view: voiceView(counted.rooms), changesAt: until + 1 }; // prettier-ignore
  const { answer } = await keptRead<BotVoice>(
    kv,
    voiceReadKey(),
    () => sources.botVoice(tenant),
    () => true,
    nowMs,
  );
  const rooms = answer?.available === true ? (roomsOf(answer.channels) ?? []) : [];
  return { view: voiceView(rooms), changesAt: null };
}

/** `bot.presence.counted`: players per game are read again at the next build. */
export async function playingMoved(kv: Kv, tenant: string): Promise<void> {
  await withTenant(tenant, () => kv.set(playingStaleKey(), "1", BOT_KEEP_MS));
}

/** One read of players per game, for the arrows: by game id, `""` for the unmatched entry. */
export interface PlayingCount {
  at: number;
  games: Record<string, number>;
}

type Game = BotPlaying["games"][number];

/**
 * The `now_playing` view-model: the three busiest games of the catalogue, each with its trend
 * once 20 minutes of reads are kept, and the players of every other game, unmatched activities
 * among them, as `others`. An activity name never reaches a screen (contracts/bot.md, Who plays
 * what); null while nobody plays.
 */
export function playingView(
  games: readonly Game[],
  history: readonly PlayingCount[],
  nowMs: number,
): Record<string, unknown> | null {
  const sorted = [...history].sort((a, b) => a.at - b.at);
  const named = games
    .filter((g) => g.game_id !== null && g.name !== null && g.player_count > 0)
    .sort((a, b) => b.player_count - a.player_count);
  const shown = named.slice(0, MAX_GAMES);
  const all = games.reduce((sum, g) => sum + g.player_count, 0);
  if (all === 0) return null;
  const others = all - shown.reduce((sum, g) => sum + g.player_count, 0);
  const listed = shown.map((g) => {
    const id = g.game_id as string;
    const trend = trendOf(sorted, (c) => c.games[id] ?? 0, nowMs);
    // An absent trend, never an undefined one: the fingerprint and the player read the same JSON.
    return { game_id: id, name: g.name, players: g.player_count, ...(trend === undefined ? {} : { trend }) }; // prettier-ignore
  });
  return { available: true, games: listed, ...(others > 0 ? { others: { players: others } } : {}) };
}

/**
 * The `now_playing` view-model at `nowMs`, read in the event's tenant context: the bot's module
 * read, again after `bot.presence.counted` or once two minutes old, at most every 30 s; each read
 * kept 25 minutes for the arrows.
 */
export async function readNowPlaying(
  kv: Kv,
  sources: Sources,
  tenant: string,
  nowMs: number,
): Promise<Record<string, unknown> | null> {
  const stale = (await kv.get(playingStaleKey())) !== null;
  const { answer, fresh } = await keptRead<BotPlaying>(
    kv,
    playingReadKey(),
    async () => {
      // The mark goes before the read: a count that lands meanwhile marks it again.
      if (stale) await kv.del(playingStaleKey());
      return sources.botPlaying(tenant);
    },
    (kept) => stale || nowMs - kept.read_at >= BOT_KEEP_MS,
    nowMs,
  );
  if (answer === null || !answer.available) return null;
  if (fresh) {
    const games = Object.fromEntries(answer.games.map((g) => [g.game_id ?? "", g.player_count]));
    await kv.addExpiring(playingHistoryKey(), JSON.stringify({ at: nowMs, games }), nowMs + HISTORY_MS); // prettier-ignore
  }
  const history = (await kv.live(playingHistoryKey(), nowMs)).map((m) => JSON.parse(m) as PlayingCount); // prettier-ignore
  return playingView(answer.games, history, nowMs);
}
