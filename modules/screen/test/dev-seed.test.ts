/**
 * The demo event's screen content on the dev server (#788): the demo photos on the photo wall, a
 * demo loop of slides and clips played in the main zone all day, and ticker lines through the day,
 * all through Screen's own routes; dev mode only, idempotent, never over a change made by hand,
 * and `force` as the reset.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  LOOP_ADDED,
  LOOP_HAND_MADE,
  LOOP_IN_PLACE,
  PHOTOS_ADDED,
  PHOTOS_HAND_MADE,
  PHOTOS_IN_PLACE,
  PHOTOS_OFF,
  Refused,
  TICKER_ADDED,
  TICKER_HAND_MADE,
  TICKER_IN_PLACE,
  seedDemoScreen,
} from "../src/dev-seed.js";
import { injectApi } from "../src/dev-seed-api.js";
import { DATABASE_URL, TENANTS, VENUE_IP, call, context, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

const MEDIA = fileURLToPath(new URL("../../../events/demo/media/", import.meta.url));
const HOST = "demo.test";
const OFF = "demo-off.test";

describe.skipIf(!DATABASE_URL)("the dev seed's screen content", () => {
  let h: Harness;
  beforeAll(async () => {
    TENANTS[HOST] = context("demo", { flags: { "screen.photos": true } });
    TENANTS[OFF] = context("demo", { flags: {} });
    h = await harness();
    // The main zone a new event starts with, as the CLI makes sure of before the seed.
    expect(
      (await call(h, "GET", "/api/screen/zones", { host: HOST, session: "admin" })).statusCode,
    ).toBe(200);
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.pool.query(
      `TRUNCATE screen_photos, screen_schedules, screen_playlists, screen_playlist_items,
         screen_asset_versions, screen_assets, screen_ticker_windows CASCADE`,
    );
    const { rm } = await import("node:fs/promises");
    await rm(join(h.filesRoot, "demo", "screen", "dev-seed.json"), { force: true });
  });

  const seed = (o: { force?: boolean; version?: string; host?: string } = {}) =>
    seedDemoScreen(
      injectApi(h.app, { host: o.host ?? HOST, cookie: "canccu_session=admin", ip: VENUE_IP }),
      {
        version: o.version ?? "dev",
        media: MEDIA,
        filesRoot: h.filesRoot,
        tenant: "demo",
        now: () => new Date(h.clock.now),
        force: o.force ?? false,
      },
    );
  const get = async <T>(url: string): Promise<T> =>
    (await call(h, "GET", url, { host: HOST, session: "admin" })).json<T>();
  const photos = async () =>
    (
      await get<{ photos: { id: string; caption: string; author_name: string }[] }>(
        "/api/screen/photos",
      )
    ).photos;
  const playlists = async () =>
    (
      await get<{ playlists: { id: string; name: string; items: unknown[] }[] }>(
        "/api/screen/playlists",
      )
    ).playlists;
  const schedules = async () =>
    (await get<{ schedules: Record<string, unknown>[] }>("/api/screen/schedules")).schedules;
  const windows = async () =>
    (
      await get<{ windows: { id: string; text: string; start_minute: number }[] }>(
        "/api/screen/ticker/windows",
      )
    ).windows;

  it("is refused outside dev mode and changes nothing", async () => {
    await expect(seed({ version: "1.4.0" })).rejects.toThrow(Refused);
    expect(await windows()).toEqual([]);
  });

  it("adds the demo photos, the demo loop for the main zone and the ticker lines", async () => {
    expect(await seed()).toEqual([PHOTOS_ADDED, LOOP_ADDED, TICKER_ADDED]);
    const wall = await photos();
    expect(wall.length).toBe(8);
    expect(wall.every((p) => p.caption.length > 0 && p.author_name.length > 0)).toBe(true);

    const [loop, ...more] = await playlists();
    expect(more).toEqual([]);
    expect(loop?.name).toBe("Demo loop");
    // Three slides, the demo clip and the demo film.
    expect(loop?.items.length).toBe(5);
    expect(await schedules()).toEqual([
      expect.objectContaining({
        zone_key: "main",
        playlist_id: loop?.id,
        priority: 0,
        days: [1, 2, 3, 4, 5, 6, 7],
        start_minute: 0,
        end_minute: 1440,
      }),
    ]);
    // A line for each part of the day, each long enough to crawl along the ticker.
    const lines = await windows();
    expect(lines.map((w) => w.start_minute).sort((a, b) => a - b)).toEqual([0, 360, 720, 1080]);
    expect(lines.every((w) => w.text.length > 100)).toBe(true);
    expect(existsSync(join(h.filesRoot, "demo", "screen", "dev-seed.json"))).toBe(true);
  });

  it("a second run changes nothing", async () => {
    await seed();
    expect(await seed()).toEqual([PHOTOS_IN_PLACE, LOOP_IN_PLACE, TICKER_IN_PLACE]);
    expect((await photos()).length).toBe(8);
    expect((await playlists()).length).toBe(1);
    expect((await windows()).length).toBe(4);
  });

  it("never over changes made by hand", async () => {
    await seed();
    const [photo] = await photos();
    await call(h, "DELETE", `/api/screen/photos/${photo?.id ?? ""}`, {
      host: HOST,
      session: "admin",
    });
    const [loop] = await playlists();
    const full = await get<Record<string, unknown>>(`/api/screen/playlists/${loop?.id ?? ""}`);
    const put = await call(h, "PUT", `/api/screen/playlists/${loop?.id ?? ""}`, {
      host: HOST,
      session: "admin",
      body: { ...full, name: "Our loop" },
    });
    expect(put.statusCode).toBe(200);
    const [line] = await windows();
    await call(h, "DELETE", `/api/screen/ticker/windows/${line?.id ?? ""}`, {
      host: HOST,
      session: "admin",
    });
    expect(await seed()).toEqual([PHOTOS_HAND_MADE, LOOP_HAND_MADE, TICKER_HAND_MADE]);
    expect((await photos()).length).toBe(7);
    expect((await playlists()).map((p) => p.name)).toEqual(["Our loop"]);
    expect((await windows()).length).toBe(3);
  });

  it("content made by hand before any seed keeps it out", async () => {
    const add = await call(h, "POST", "/api/screen/ticker/windows", {
      host: HOST,
      session: "admin",
      body: { text: "Our own line", days: [1], start_minute: 0, end_minute: 60 },
    });
    expect(add.statusCode).toBe(201);
    expect((await seed())[2]).toBe(TICKER_HAND_MADE);
    expect((await windows()).map((w) => w.text)).toEqual(["Our own line"]);
  });

  it("force puts the seed's content back over hand changes", async () => {
    await seed();
    const [photo] = await photos();
    await call(h, "DELETE", `/api/screen/photos/${photo?.id ?? ""}`, {
      host: HOST,
      session: "admin",
    });
    const [line] = await windows();
    await call(h, "DELETE", `/api/screen/ticker/windows/${line?.id ?? ""}`, {
      host: HOST,
      session: "admin",
    });
    expect(await seed({ force: true })).toEqual([PHOTOS_ADDED, LOOP_ADDED, TICKER_ADDED]);
    expect((await photos()).length).toBe(8);
    expect((await playlists()).length).toBe(1);
    expect((await schedules()).length).toBe(1);
    expect((await windows()).length).toBe(4);
    expect(await seed()).toEqual([PHOTOS_IN_PLACE, LOOP_IN_PLACE, TICKER_IN_PLACE]);
  });

  it("adds no photos while the event's photo wall is off", async () => {
    expect((await seed({ host: OFF }))[0]).toBe(PHOTOS_OFF);
  });
});
