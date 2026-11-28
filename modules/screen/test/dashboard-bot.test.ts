/**
 * The Dashboard's voice rooms and now playing boxes, composed from the bot's module reads
 * (contracts/screen.md, Widgets: `voice_rooms`, `now_playing`; Boxes waiting for their source).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, call, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Region {
  id: string;
  widgets: { widget: string; view: Record<string, unknown> }[];
}

describe.skipIf(!DATABASE_URL)("the Dashboard fed by the bot", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    await call(h, "POST", "/api/screen/zones", {
      session: "admin",
      body: { key: "hall", name: "Hall", layout_id: "dashboard" },
    });
  });
  afterAll(async () => {
    await h.close();
  });

  const regions = async () =>
    (await call(h, "GET", "/api/screen/zones/hall/state", { session: "admin" })).json<{
      regions: Region[];
    }>().regions;
  const box = async (id: string) => (await regions()).find((r) => r.id === id);

  it("gives the voice and games boxes away while the bot has nothing to show", async () => {
    h.sources.voice = { available: false, as_of: null, channels: [] };
    h.sources.playing = { available: false, as_of: null, games: [] };
    const ids = (await regions()).map((r) => r.id);
    expect(ids).not.toContain("voice");
    expect(ids).not.toContain("top_games");
  });

  it("draws the busy public rooms and the players per game once the bot counts them", async () => {
    // Past the 2 minutes a kept answer holds without a count from the bot.
    h.clock.now += 121_000;
    h.sources.voice = {
      available: true,
      as_of: new Date(h.clock.now).toISOString(),
      channels: [
        { channel_id: "300000000000000011", name: "Match 3 · Team A", member_count: 5 },
        { channel_id: "300000000000000010", name: "Lobby", member_count: 14 },
      ],
    };
    h.sources.playing = {
      available: true,
      as_of: new Date(h.clock.now).toISOString(),
      games: [{ game_id: null, name: null, player_count: 11 }],
    };
    expect((await box("voice"))?.widgets[0]).toMatchObject({
      widget: "voice_rooms",
      view: {
        empty: false,
        rooms: [
          { name: "Lobby", member_count: 14 },
          { name: "Match 3 · Team A", member_count: 5 },
        ],
      },
    });
    const games = (await box("top_games"))?.widgets[0]?.view;
    expect(games).toMatchObject({ empty: false, games: [], others: { players: 11 } });
    // Counts only: no Discord id or channel reaches a screen.
    expect(JSON.stringify(await regions())).not.toContain("30000000000000001");
  });

  it("gives the hub's view of the zone the same players per game", async () => {
    const now = (await call(h, "GET", "/api/screen/now?zone=hall", { host: "alpha.test" })).json<{
      regions: Region[];
    }>();
    const playing = now.regions.flatMap((r) => r.widgets).find((w) => w.widget === "now_playing");
    expect(playing?.view).toMatchObject({ empty: false, others: { players: 11 } });
  });
});
