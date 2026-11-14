/**
 * The stage end to end (contracts/screen.md, The stage): a hot-game claim from a fixture
 * `moments.override.started` asks for a tint, Screen blurs the game's cover once and serves it to
 * the event's screens only, and the tint ends after 60 s.
 */
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, withTenant } from "@canccu/kit";
import { applyOverrideEvent } from "../src/compose/overrides.js";
import { DATABASE_URL, call, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Stage {
  phase: string;
  kind: string | null;
  tint: {
    region_id: string;
    widget: string;
    until: string;
    art: { url: string; scrim: number } | null;
  } | null;
}
interface State {
  display: { stage?: Stage };
  regions: { id: string; claim: { content: Record<string, unknown> } | null }[];
}

const SINCE = "2026-01-01T12:00:30Z";
const COVER = "/games/covers/g_1.png";

describe.skipIf(!DATABASE_URL)("the stage", () => {
  let h: Harness;
  let token = "";

  beforeAll(async () => {
    h = await harness();
    h.clock.now = Date.parse("2026-01-01T12:00:40Z");
    h.sources.event = { name: "Demo Event" };
    h.sources.agenda = { current: [], next: [] };
    h.covers[COVER] = await sharp({
      create: { width: 800, height: 400, channels: 3, background: "#7c3aed" },
    })
      .png()
      .toBuffer();
    const device = await pairDevice(h);
    token = device.token;
    await call(h, "GET", "/api/screen/zones", { session: "admin" });
    await call(h, "PUT", `/api/screen/devices/${device.id}/assignment`, {
      session: "admin",
      body: { zone_key: "main" },
    });
    const content = {
      game: { id: "g_1", name: "Demo Game", cover_url: COVER },
      players: 14,
      since: SINCE,
    };
    await withTenant("alpha", () =>
      applyOverrideEvent(h.db, {
        id: newId(),
        type: "moments.override.started",
        version: 1,
        time: SINCE,
        source: "moments",
        tenant: "alpha",
        data: {
          actor_user_id: null,
          override: {
            id: "ov_12",
            kind: "block",
            zones: ["main"],
            rank: 50,
            source: { module: "moments", event_id: null, ref: "g_1" },
            template: "hot_game",
            content,
            regions: ["hero", "rail"],
            ttl_seconds: 600,
            sound: null,
            steps: null,
            on_end: "next",
            starts_at: SINCE,
            ends_at: null,
          },
        },
      }),
    );
  });
  afterAll(async () => {
    await h.close();
  });

  const state = async () =>
    (
      await call(h, "GET", "/api/screen/device/state", { cookies: { canccu_device: token } })
    ).json<State>();

  it("reads no cover for the hub's view, which has no stage", async () => {
    const now = await call(h, "GET", "/api/screen/now?zone=main", { host: "alpha.test" });
    expect(now.statusCode).toBe(200);
    expect(h.coverReads).toEqual([]);
  });

  it("tints the stage with the blurred art, served to the event's screens only", async () => {
    const s = await state();
    const tint = s.display.stage?.tint;
    expect(s.display.stage?.phase).toBe("build_up");
    expect(tint).toMatchObject({
      region_id: "hero",
      widget: "hot_game",
      until: "2026-01-01T12:01:30.000Z",
    });
    expect(tint?.art?.url).toMatch(/^\/api\/screen\/art\/[a-f0-9]{64}\.webp$/);
    expect(tint?.art?.scrim).toBeGreaterThanOrEqual(0.55);
    const card = s.regions.find((r) => r.id === "hero")?.claim?.content.card_art;
    expect(card).toMatchObject({ url: COVER });

    const url = tint?.art?.url ?? "";
    const art = await call(h, "GET", url, { cookies: { canccu_device: token } });
    expect(art.statusCode).toBe(200);
    expect(art.headers["content-type"]).toBe("image/webp");
    expect(art.headers["cache-control"]).toContain("immutable");
    expect((await call(h, "GET", url, { session: "crew" })).statusCode).toBe(200);
    expect((await call(h, "GET", url, { session: "nobody" })).statusCode).toBe(403);
    expect((await call(h, "GET", url, {})).statusCode).toBe(401);
    expect((await call(h, "GET", url, { host: "beta.test", session: "admin" })).statusCode).toBe(
      404,
    );
    const unknown = `/api/screen/art/${"0".repeat(64)}.webp`;
    expect((await call(h, "GET", unknown, { session: "admin" })).statusCode).toBe(404);
  });

  it("keeps the tint without art while the event switches the art off", async () => {
    h.settings.alpha = { ...h.settings.alpha, stage_art: false };
    try {
      const tint = (await state()).display.stage?.tint;
      expect(tint).not.toBeNull();
      expect(tint?.art).toBeNull();
    } finally {
      h.settings.alpha = { ...h.settings.alpha, stage_art: true };
    }
  });

  it("ends the tint 60 s after the surge", async () => {
    h.clock.now = Date.parse("2026-01-01T12:01:31Z");
    expect((await state()).display.stage?.tint).toBeNull();
  });
});
