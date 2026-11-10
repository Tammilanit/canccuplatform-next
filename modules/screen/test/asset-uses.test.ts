// Assets as playlists and pushes use them (#285): only this event's assets, with the legacy
// `playlist-builder.ts` kind rules; what uses an asset keeps it from being deleted and is named
// in `used_by`; and the tick and simulate read the assets from their tables.
import { withTenant } from "@canccu/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readAssets } from "../src/assets/reader.js";
import { resolveFrame } from "../src/playback/engine.js";
import { isPlayable } from "../src/playback/timeline.js";
import { loadContent } from "../src/tick/content.js";
import { tickRunner } from "../src/tick/run.js";
import type { ZoneState } from "../src/tick/zone.js";
import { DATABASE_URL, TENANTS, call, code, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { seedAssets } from "./seed.js";

const as = (session: string, body?: unknown, host = "alpha.test") => ({ host, session, body });

describe.skipIf(!DATABASE_URL)("assets in playlists and pushes", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    // The tick runs only for events with screens.
    await pairDevice(h);
    await call(h, "GET", "/api/screen/zones", as("admin"));
    await seedAssets(
      h,
      { id: "as_img", kind: "image" },
      { id: "as_img2", kind: "image" },
      { id: "as_vid", kind: "video", durationSeconds: 12.4 },
      { id: "as_deck", kind: "pdf", slides: 4 },
      { id: "as_fresh", kind: "pptx" },
      { id: "as_beta", kind: "image", tenant: "beta" },
    );
  });
  afterAll(async () => {
    await h.close();
  });

  const save = (items: unknown[], extra: Record<string, unknown> = {}) =>
    call(
      h,
      "POST",
      "/api/screen/playlists",
      as("admin", { name: "Checks", type: "regular", items, ...extra }),
    );
  const refused = async (items: unknown[], message: RegExp, extra = {}) => {
    const res = await save(items, extra);
    expect(code(res)).toBe("invalid_request");
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(message);
  };

  it("takes only this event's assets in playlists and pushes", async () => {
    await refused([{ asset_id: "as_none", duration_seconds: 5 }], /items\[0\].*no such asset/);
    await refused([{ asset_id: "as_beta", duration_seconds: 5 }], /no such asset/);
    const until = new Date(h.clock.now + 60_000).toISOString();
    for (const asset_id of ["as_none", "as_beta"]) {
      const res = await call(
        h,
        "POST",
        "/api/screen/push",
        as("admin", { zones: [], asset_id, until }),
      );
      expect(code(res)).toBe("invalid_request");
    }
  });

  it("keeps the legacy kind rules", async () => {
    await refused([{ asset_id: "as_img", duration_seconds: null }], /only a video/);
    await refused([{ asset_id: "as_deck", duration_seconds: null }], /only a video/);
    await refused(
      [{ asset_id: "as_img", duration_seconds: 5, slide_start: 1 }],
      /only on a PowerPoint deck or a PDF/,
    );
    await refused(
      [{ asset_id: "as_vid", duration_seconds: null, slide_seconds: 3 }],
      /only on a PowerPoint deck or a PDF/,
    );
    await refused(
      [{ asset_id: "as_deck", duration_seconds: 20, slide_start: 2, slide_end: 5 }],
      /4 slides/,
    );
    await refused([{ asset_id: "as_deck", duration_seconds: 20, slide_start: 5 }], /4 slides/);
    const ok = await save([
      { asset_id: "as_vid", duration_seconds: null },
      { asset_id: "as_deck", duration_seconds: 20, slide_start: 2, slide_end: 4, slide_seconds: 5 },
      // A deck not yet rendered has no count to hold a range to; its render clamps it.
      { asset_id: "as_fresh", duration_seconds: 20, slide_start: 3, slide_end: 40 },
    ]);
    expect(ok.statusCode).toBe(201);
    // A slideshow's images last its own dwell, so their length may be left to it.
    const show = await save([{ asset_id: "as_img", duration_seconds: null }], {
      type: "slideshow",
      slideshow_image_seconds: 6,
    });
    expect(show.statusCode).toBe(201);
    await call(h, "DELETE", `/api/screen/playlists/${ok.json<{ id: string }>().id}`, as("admin"));
    await call(h, "DELETE", `/api/screen/playlists/${show.json<{ id: string }>().id}`, as("admin"));
  });

  it("keeps an asset that a playlist or an active push uses, and names them in used_by", async () => {
    const usedBy = async (id: string) =>
      (await call(h, "GET", "/api/screen/assets?q=" + id, as("admin")))
        .json<{ assets: { id: string; used_by: string[] }[] }>()
        .assets.find((a) => a.id === id)?.used_by;
    const playlist = (
      await save([{ asset_id: "as_img2", duration_seconds: 5 }], { name: "Uses" })
    ).json<{ id: string }>().id;
    const until = new Date(h.clock.now + 60_000).toISOString();
    const pushed = await call(
      h,
      "POST",
      "/api/screen/push",
      as("admin", { zones: [], asset_id: "as_img2", until }),
    );
    expect(pushed.statusCode).toBe(201);
    const push = pushed.json<{ id: string }>().id;
    expect((await usedBy("as_img2"))?.sort()).toEqual([playlist, push].sort());

    const remove = () => call(h, "DELETE", "/api/screen/assets/as_img2", as("admin"));
    let res = await remove();
    expect(code(res)).toBe("asset_in_use");
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(/Uses/);
    await call(h, "DELETE", `/api/screen/playlists/${playlist}`, as("admin"));
    res = await remove();
    expect(code(res)).toBe("asset_in_use");
    expect(await usedBy("as_img2")).toEqual([push]);
    // A push past its `until` no longer holds the asset, even before the tick ends it.
    h.clock.now += 61_000;
    expect(await usedBy("as_img2")).toEqual([]);
    expect((await remove()).statusCode).toBe(204);
  });

  it("plays a pushed asset and a scheduled playlist's assets from the asset tables", async () => {
    await call(h, "POST", "/api/screen/zones", as("admin", { key: "hall", name: "Hall" }));
    const playlist = (
      await save(
        [
          { asset_id: "as_img", duration_seconds: 10 },
          { asset_id: "as_vid", duration_seconds: null },
        ],
        { name: "Hall loop" },
      )
    ).json<{ id: string }>().id;
    const window = await call(
      h,
      "POST",
      "/api/screen/schedules",
      as("admin", {
        zone_key: "hall",
        playlist_id: playlist,
        priority: 1,
        days: [1, 2, 3, 4, 5, 6, 7],
        start_minute: 0,
        end_minute: 1440,
      }),
    );
    expect(window.statusCode).toBe(201);
    const tick = tickRunner({
      db: h.db,
      kv: h.kv,
      bus: h.bus,
      audit: () => Promise.resolve(),
      settings: { ensure: () => Promise.resolve(), get: (_key, fallback) => fallback },
      assets: readAssets,
      tenantById: (id) =>
        Promise.resolve(Object.values(TENANTS).find((t) => t.tenant_id === id) ?? null),
      now: () => h.clock.now,
    });
    const state = async () =>
      (
        await h.pool.query<{ state: ZoneState }>(
          "SELECT state FROM screen_zone_playback WHERE tenant_id = 'alpha' AND zone_key = 'hall'",
        )
      ).rows[0]?.state;

    await tick();
    h.clock.now += 15_000;
    const content = await withTenant("alpha", () =>
      h.db.tenant((c) => loadContent(c, readAssets, h.clock.now)),
    );
    const loop = content.playlists.get(playlist);
    const bookmark = (await state())?.bookmarks[playlist];
    if (loop === undefined || bookmark === undefined) throw new Error("the loop never played");
    // 15 s in: the image (10 s) is over, and the video plays its own 12.4 s, rounded up.
    expect(resolveFrame(loop, content.assets, bookmark, h.clock.now)).toMatchObject({
      assetId: "as_vid",
      kind: "video",
      offsetSeconds: 5,
      durationSeconds: 8,
    });

    const until = new Date(h.clock.now + 60_000).toISOString();
    const pushed = await call(
      h,
      "POST",
      "/api/screen/push",
      as("admin", { zones: ["hall"], asset_id: "as_img", until }),
    );
    const push = pushed.json<{ id: string }>().id;
    h.clock.now += 1000;
    await tick();
    expect((await state())?.playing).toMatchObject({
      source: "push",
      pushId: push,
      assetId: "as_img",
    });
    // What the zone shows for the push: the pushed image, read from its tables.
    const now = await withTenant("alpha", () =>
      h.db.tenant((c) => loadContent(c, readAssets, h.clock.now)),
    );
    expect(isPlayable(now.assets.get("as_img"))).toBe(true);
    expect(now.assets.get("as_img")?.kind).toBe("image");
    // The video's place is kept: paused 16 s into the loop, 6 s into the video.
    expect((await state())?.bookmarks[playlist]).toMatchObject({
      offsetMs: 6000,
      runningSince: null,
    });

    // Simulate's breaks show only when their assets are playable: an image here.
    const ad = await save([{ asset_id: "as_img", duration_seconds: 5 }], {
      name: "Hall ads",
      type: "break",
      break: { zones: ["hall"], period_seconds: 60, break_seconds: 5 },
    });
    expect(ad.statusCode).toBe(201);
    const inBreak: boolean[] = [];
    for (let s = 0; s <= 70; s += 1) {
      const at = new Date(h.clock.now + s * 1000).toISOString();
      const res = await call(
        h,
        "GET",
        `/api/screen/schedules/simulate?zone=hall&at=${at}`,
        as("admin"),
      );
      inBreak.push(res.json<{ in_break: boolean }>().in_break);
    }
    expect(inBreak).toContain(true);
  });
});
