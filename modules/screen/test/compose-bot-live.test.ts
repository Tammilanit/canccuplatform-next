/**
 * The bot's live counts on the screens (contracts/screen.md, Widgets: `voice_rooms`,
 * `now_playing`): the public voice rooms from `bot.voice.counted`, or the bot's module read while
 * no count of the last minutes is kept, and players per game from the bot's module read, read again
 * on `bot.presence.counted` at most every 30 s. Counts only, never who.
 */
import { withTenant } from "@canccu/kit";
import { describe, expect, it } from "vitest";
import {
  keepVoice,
  playingMoved,
  playingView,
  readPlaying,
  readVoice,
  voiceOf,
  voiceView,
} from "../src/compose/bot-live.js";
import type { BotPlaying, BotVoice } from "../src/compose/sources.js";
import { noSources } from "../src/compose/sources.js";
import type { Sources } from "../src/compose/sources.js";
import { countsOf } from "../src/compose/stats.js";
import { MemoryKv } from "../src/kv.js";

const T0 = Date.parse("2026-03-14T18:00:00Z");
const MIN = 60_000;
const clock = { now: T0 };
const room = (name: string, n: number) => ({ channel_id: `c_${name}`, name, member_count: n });

function reading(answers: { playing?: BotPlaying | null; voice?: BotVoice | null }) {
  const reads = { playing: 0, voice: 0 };
  const sources: Sources = {
    ...noSources,
    botPlaying: () => {
      reads.playing += 1;
      return Promise.resolve(answers.playing ?? null);
    },
    botVoice: () => {
      reads.voice += 1;
      return Promise.resolve(answers.voice ?? null);
    },
  };
  return { sources, reads };
}

const inTenant = <T>(fn: () => Promise<T>) => withTenant("alpha", fn);

describe("voice rooms", () => {
  it("reads bot.voice.counted and refuses anything else", () => {
    const data = { counted_at: "2026-03-14T18:00:00Z", interval_seconds: 60, rooms: [room("Lobby", 14)] };
    expect(voiceOf(data)).toEqual({
      at: T0,
      interval_seconds: 60,
      rooms: [{ name: "Lobby", member_count: 14 }],
    });
    expect(voiceOf({ ...data, rooms: [{ name: "Lobby", member_count: -1 }] })).toBeNull();
    expect(voiceOf({ ...data, counted_at: "soon" })).toBeNull();
  });

  it("shows at most six rooms, busiest first, by name and count only", () => {
    const rooms = ["A", "B", "C", "D", "E", "F", "G"].map((n, i) => ({ name: n, member_count: i + 1 }));
    expect(voiceView(rooms)).toEqual({
      rooms: [
        { name: "G", member_count: 7 },
        { name: "F", member_count: 6 },
        { name: "E", member_count: 5 },
        { name: "D", member_count: 4 },
        { name: "C", member_count: 3 },
        { name: "B", member_count: 2 },
      ],
    });
    expect(voiceView([])).toBeNull();
  });

  it("draws the kept count while it is live, then reads the bot as a module", async () => {
    const kv = new MemoryKv(() => clock.now);
    const voice = { available: true, as_of: "", channels: [room("Lobby 2", 4)] };
    const { sources, reads } = reading({ voice });
    const counted = voiceOf({
      counted_at: new Date(T0).toISOString(),
      interval_seconds: 60,
      rooms: [room("Lobby", 14), room("Match 3 · Team A", 5)],
    });
    if (counted === null) throw new Error("not a count");
    await keepVoice(kv, "alpha", counted);
    const live = await inTenant(() => readVoice(kv, sources, "alpha", T0 + MIN));
    expect(live.view).toEqual({
      rooms: [
        { name: "Lobby", member_count: 14 },
        { name: "Match 3 · Team A", member_count: 5 },
      ],
    });
    // The zone is built again once the count is no longer live, so it falls back then.
    expect(live.changesAt).toBe(T0 + 3 * MIN + 1);
    expect(reads.voice).toBe(0);
    const later = await inTenant(() => readVoice(kv, sources, "alpha", T0 + 4 * MIN));
    expect(later.view).toEqual({ rooms: [{ name: "Lobby 2", member_count: 4 }] });
    await inTenant(() => readVoice(kv, sources, "alpha", T0 + 4 * MIN + 20_000));
    expect(reads.voice).toBe(1);
    await inTenant(() => readVoice(kv, sources, "alpha", T0 + 4 * MIN + 31_000));
    expect(reads.voice).toBe(2);
  });

  it("is empty while the bot says it is not available, and keeps the last answer when a read fails", async () => {
    const kv = new MemoryKv(() => clock.now);
    const off = reading({ voice: { available: false, as_of: null, channels: [] } });
    expect((await inTenant(() => readVoice(kv, off.sources, "alpha", T0))).view).toBeNull();
    const kv2 = new MemoryKv(() => clock.now);
    const up = reading({ voice: { available: true, as_of: "", channels: [room("Lobby", 3)] } });
    await inTenant(() => readVoice(kv2, up.sources, "alpha", T0));
    const down = reading({ voice: null });
    const kept = await inTenant(() => readVoice(kv2, down.sources, "alpha", T0 + MIN));
    expect(kept.view).toEqual({ rooms: [{ name: "Lobby", member_count: 3 }] });
  });
});

const game = (game_id: string | null, name: string | null, player_count: number) => ({
  game_id,
  name,
  player_count,
});

describe("now playing", () => {
  it("lists the three busiest games of the catalogue and adds up the rest", () => {
    const games = [
      game("g_1", "Demo Arena", 18),
      game(null, null, 7),
      game("g_2", "Space Racer", 9),
      game("g_3", "Block Builder", 6),
      game("g_4", "Demo Quest", 4),
    ];
    expect(playingView(games, [], T0)).toEqual({
      available: true,
      games: [
        { game_id: "g_1", name: "Demo Arena", players: 18 },
        { game_id: "g_2", name: "Space Racer", players: 9 },
        { game_id: "g_3", name: "Block Builder", players: 6 },
      ],
      others: { players: 11 },
    });
  });

  it("never names an activity: without the catalogue it is only the others", () => {
    expect(playingView([game(null, null, 5)], [], T0)).toEqual({
      available: true,
      games: [],
      others: { players: 5 },
    });
    expect(playingView([], [], T0)).toBeNull();
  });

  it("gives each game its trend once 20 minutes of counts are read", () => {
    const history = Array.from({ length: 21 }, (_, i) => ({
      at: T0 - (20 - i) * MIN,
      games: { g_1: i < 10 ? 10 : 20, g_2: 9 },
    }));
    const view = playingView([game("g_1", "Demo Arena", 20), game("g_2", "Space Racer", 9)], history, T0);
    expect(view?.games).toEqual([
      { game_id: "g_1", name: "Demo Arena", players: 20, trend: "up" },
      { game_id: "g_2", name: "Space Racer", players: 9, trend: "flat" },
    ]);
  });

  it("reads the bot at most every 30 s, again after bot.presence.counted", async () => {
    const kv = new MemoryKv(() => clock.now);
    const { sources, reads } = reading({
      playing: { available: true, as_of: "", games: [game("g_1", "Demo Arena", 3)] },
    });
    const first = await inTenant(() => readPlaying(kv, sources, "alpha", T0));
    expect(first).toMatchObject({ games: [{ game_id: "g_1", players: 3 }] });
    await playingMoved(kv, "alpha");
    await inTenant(() => readPlaying(kv, sources, "alpha", T0 + 10_000));
    expect(reads.playing).toBe(1);
    await inTenant(() => readPlaying(kv, sources, "alpha", T0 + 31_000));
    expect(reads.playing).toBe(2);
    // No count came since: the kept answer holds until it is two minutes old.
    await inTenant(() => readPlaying(kv, sources, "alpha", T0 + 2 * MIN));
    expect(reads.playing).toBe(2);
    await inTenant(() => readPlaying(kv, sources, "alpha", T0 + 31_000 + 2 * MIN));
    expect(reads.playing).toBe(3);
  });

  it("is empty while the bot says it is not available", async () => {
    const kv = new MemoryKv(() => clock.now);
    const { sources } = reading({ playing: { available: false, as_of: null, games: [] } });
    expect(await inTenant(() => readPlaying(kv, sources, "alpha", T0))).toBeNull();
  });
});

describe("which counts a zone reads", () => {
  it("names the bot's counts each widget type reads", () => {
    expect(countsOf(new Set(["voice_rooms"]))).toEqual(["voice"]);
    expect(countsOf(new Set(["now_playing"]))).toEqual(["playing"]);
    expect(countsOf(new Set(["activity_graph"]))).toEqual(["presence", "messages"]);
    expect(countsOf(new Set(["stats"]))).toEqual(["presence", "checkins"]);
  });
});
