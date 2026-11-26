/**
 * Announcements by level and placement on the engine (contracts/moments.md, Levels, placement and
 * the full screen; #780): what each level sends to Screen, the cue it plays, its living details,
 * and an edit that plays nothing again.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Event } from "@canccu/kit";
import { compose, editAnnouncement } from "../src/announce/service.js";
import type { Draft } from "../src/announce/service.js";
import { lockAnnouncement } from "../src/announce/store.js";
import { storeAgenda } from "../src/scene-store.js";
import { addZone } from "../src/store.js";
import { tickTenant } from "../src/tick.js";
import { DATABASE_URL, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";

const CREW = { user_id: "u_crew", name: "Demo Crew" };

const draft = (o: Partial<Draft> = {}): Draft => ({
  level: "important",
  placement: "hero",
  icon: "trophy",
  full_screen: false,
  title_text: "Finals start",
  body_text: "Main stage",
  variables: {},
  item_id: null,
  channels: { screen: true, ticker: false, discord: false, push: false },
  zones: [],
  duration_seconds: 300,
  when: { mode: "now" },
  event_name: "Demo Event",
  time_zone: "UTC",
  template_key: null,
  ...o,
});

// More than the scenes' AgendaItem names: the composer reads the title and the location too.
const FINALS = {
  id: "it_finals",
  title: "Demo Game Cup, finals",
  kind: "tournament",
  visibility: "public",
  status: "scheduled",
  location: "Stage",
  starts_at: "2026-01-01T21:00:00Z",
  ends_at: null,
};

const started = (events: Event[]) =>
  events
    .filter((e) => e.type === "moments.override.started")
    .map((e) => e.data.override as Record<string, unknown>)
    .filter((o) => o.template === "announcement");

describe.skipIf(!DATABASE_URL)("announcements by level", () => {
  let pool: pg.Pool;
  let w: World;
  beforeAll(async () => {
    pool = await freshDatabase();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(
      `TRUNCATE moments, moment_overrides, moment_placements, moment_slots, moments_zone_air, moments_zones, moments_history,
        moments_outbox, moments_announcements, moments_sources, moments_sound_zones,
        moments_sound_log, moments_tenants, moments_cues`,
    );
    w = world(pool);
    await w.tx("demo", async (c) => {
      await addZone(c, "main");
      await addZone(c, "entrance");
    });
  });

  const send = (o: Partial<Draft> = {}) =>
    w.tx("demo", (c) => compose(c, w.engine, draft(o), CREW, w.now));

  it("an Important asks for the hero of 35 % or more, falling to the full screen", async () => {
    const a = await send();
    const [card] = started(w.events("demo"));
    expect(card).toMatchObject({
      regions: ["hero", "full", "rail", "ticker"],
      hero_min_share: 0.35,
      keep_ticker: true,
      rank: 80,
      content: {
        title: "Finals start",
        level: "important",
        placement: "hero",
        icon: "trophy",
        art: null,
        second_line: null,
        qr: null,
        countdown_at: null,
        expires_at: new Date(w.now.getTime() + 300_000).toISOString(),
      },
    });
    expect(a).toMatchObject({ placement: "hero", icon: "trophy", full_screen: false });
  });

  it("an Important plays its own bright cue, once", async () => {
    await send();
    const played = w.events("demo").filter((e) => e.type === "moments.sound.played");
    const cues = played.map((e) => (e.data.sound as { cue: string }).cue);
    // Once per zone: main and entrance.
    expect(cues).toEqual(["announce.important", "announce.important"]);
  });

  it("an Urgent goes to every zone at full screen, with no ticker kept under it", async () => {
    await send({ level: "urgent", placement: "full", full_screen: true });
    const cards = started(w.events("demo"));
    expect(cards.map((c) => c.zones)).toEqual([["main"], ["entrance"]]);
    expect(cards[0]).toMatchObject({
      regions: ["full", "hero", "rail", "ticker"],
      hero_min_share: null,
      keep_ticker: false,
    });
  });

  it("an Info at full screen keeps the ticker running under it", async () => {
    await send({ level: "info", placement: "full", full_screen: true, icon: "megaphone" });
    expect(started(w.events("demo"))[0]).toMatchObject({
      regions: ["full", "hero", "rail", "ticker"],
      keep_ticker: true,
    });
    const sent = w.events("demo").find((e) => e.type === "moments.announcement.sent");
    expect(sent?.data).toMatchObject({ level: "info", placement: "full", full_screen: true });
  });

  it("counts down to its run-of-show item when it was sent with one", async () => {
    await w.tx("demo", (c) => storeAgenda(c, { agenda_version: 1, items: [FINALS] }));
    await send({ item_id: "it_finals", when: { mode: "item", minutes_before: 0 } });
    await w.tx("demo", (c) => tickTenant(c, w.engine, new Date("2026-01-01T21:00:00Z")));
    expect(started(w.events("demo"))[0]?.content).toMatchObject({
      countdown_at: "2026-01-01T21:00:00.000Z",
    });
  });

  it("an edit of a live Important plays no cue and starts nothing again", async () => {
    const a = await send();
    const before = w.events("demo").length;
    await w.tx("demo", async (c) =>
      editAnnouncement(
        c,
        w.engine,
        (await lockAnnouncement(c, a.id)) as NonNullable<
          Awaited<ReturnType<typeof lockAnnouncement>>
        >,
        { title_text: "Finals start now", body_text: "Main stage", variables: {} },
        CREW,
        w.now,
      ),
    );
    const after = w.events("demo").slice(before);
    expect(after.some((e) => e.type === "moments.sound.played")).toBe(false);
    expect(after.some((e) => e.type === "moments.override.started")).toBe(false);
    const changed = after.find((e) => e.type === "moments.override.changed");
    expect((changed?.data.override as Record<string, unknown>).content).toMatchObject({
      title: "Finals start now",
      updated: true,
      starts_at: (started(w.events("demo"))[0]?.content as Record<string, unknown>).starts_at,
    });
  });
});
