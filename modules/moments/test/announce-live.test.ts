/**
 * The announcements API by level and placement, and the hub's live read (contracts/moments.md,
 * Levels, placement and the full screen; Sending; #780).
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addZone } from "../src/store.js";
import { appWorld, json } from "./app.js";
import type { AppWorld } from "./app.js";
import { DATABASE_URL, freshDatabase } from "./helpers.js";

const BASE = { title: "Wi-Fi is down", body: "Use the wired seats", level: "info" };

describe.skipIf(!DATABASE_URL)("announcements by level, through the API", () => {
  let pool: pg.Pool;
  let w: AppWorld;
  beforeAll(async () => {
    pool = await freshDatabase();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(
      `TRUNCATE moments, moment_overrides, moment_placements, moment_slots, moments_zone_air, moments_zones, moments_history,
        moments_outbox, moments_announcements, moments_announcement_templates, moments_sources,
        moments_idempotency, moments_sound_zones, moments_sound_log, moments_tenants`,
    );
    w = await appWorld(pool);
    await w.tx("demo", async (c) => {
      await addZone(c, "main");
    });
  });

  const post = (body: unknown) => w.call("crew", "POST", "/api/moments/announcements", body);
  const sent = async (body: unknown) => json(await post(body));

  it("takes the level's placement when neither placement nor full_screen is sent", async () => {
    expect(await sent({ ...BASE, level: "urgent" })).toMatchObject({
      placement: "full",
      full_screen: true,
    });
    expect(await sent({ ...BASE, level: "important" })).toMatchObject({
      placement: "hero",
      full_screen: false,
    });
    expect(await sent(BASE)).toMatchObject({ placement: "rail", icon: "info" });
  });

  it("keeps an old client's full_screen, and lets placement win when both are sent", async () => {
    expect(await sent({ ...BASE, full_screen: true })).toMatchObject({ placement: "full" });
    expect(await sent({ ...BASE, level: "urgent", full_screen: false })).toMatchObject({
      placement: "rail",
      full_screen: false,
    });
    expect(await sent({ ...BASE, placement: "hero", full_screen: true })).toMatchObject({
      placement: "hero",
      full_screen: false,
    });
  });

  it("refuses a placement or an icon it does not know", async () => {
    expect((await post({ ...BASE, placement: "sky" })).statusCode).toBe(400);
    expect((await post({ ...BASE, icon: "rocket" })).statusCode).toBe(400);
  });

  it("previews the chain of the chosen placement", async () => {
    const r = await w.call("crew", "POST", "/api/moments/announcements/preview", {
      ...BASE,
      level: "important",
    });
    expect(json(r).regions).toEqual(["hero", "full", "rail", "ticker"]);
  });

  it("lists the live screen announcements for a guest, newest first, without who sent them", async () => {
    await sent({ ...BASE, icon: "wifi" });
    w.now = new Date(w.now.getTime() + 1000);
    await sent({ ...BASE, title: "Pizza is here", level: "important", icon: "food" });
    await sent({ ...BASE, title: "Only on Discord", channels: { screen: false, discord: true } });
    const r = await w.call(null, "GET", "/api/moments/announcements/live");
    expect(r.statusCode).toBe(200);
    const list = json(r).announcements as Record<string, unknown>[];
    expect(list.map((a) => a.title)).toEqual(["Pizza is here", "Wi-Fi is down"]);
    expect(list[0]).toEqual({
      id: expect.any(String) as string,
      level: "important",
      title: "Pizza is here",
      body: "Use the wired seats",
      icon: "food",
      art: null,
      sent_at: w.now.toISOString(),
      expires_at: new Date(w.now.getTime() + 300_000).toISOString(),
      zones: [],
    });
  });

  it("follows the info-page mode: a guest is kept out, a signed-in member reads on", async () => {
    await sent(BASE);
    const guest = await w.call(null, "GET", "/api/moments/announcements/live", undefined, {
      host: "closed.test",
    });
    expect(guest.statusCode).toBe(403);
    const member = await w.call("reader", "GET", "/api/moments/announcements/live", undefined, {
      host: "closed.test",
    });
    expect(member.statusCode).toBe(200);
    expect(json(member).announcements).toHaveLength(1);
  });

  it("a template keeps its icon, and the built-ins carry theirs", async () => {
    const put = await w.call("admin", "PUT", "/api/moments/announcement-templates/pickup", {
      name: "Pickup",
      title: "Pickup at the café",
      level: "important",
      icon: "food",
      revision: 0,
    });
    expect(put.statusCode).toBe(200);
    expect(json(put)).toMatchObject({ level: "important", icon: "food" });
    const all = json(await w.call("crew", "GET", "/api/moments/announcement-templates"))
      .templates as { key: string; icon: string }[];
    const icons = Object.fromEntries(all.map((t) => [t.key, t.icon]));
    expect(icons).toMatchObject({
      starting_soon: "clock",
      food: "food",
      lost_found: "search",
      doors_close: "door",
      pickup: "food",
    });
  });
});
