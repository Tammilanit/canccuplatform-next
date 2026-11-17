/**
 * Announcements on the engine (contracts/moments.md, Announcements; #115): the card and the ticker
 * line as moments, the levels' chains and the full screen, sending now, at a time or with a
 * run-of-show item that moves and cancels, editing in place and withdrawing silently.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Event } from "@canccu/kit";
import {
  compose,
  editAnnouncement,
  tickAnnouncements,
  withdrawAnnouncement,
} from "../src/announce/service.js";
import type { Draft } from "../src/announce/service.js";
import { lockAnnouncement } from "../src/announce/store.js";
import { storeAgenda } from "../src/scene-store.js";
import { addZone, lockMoment } from "../src/store.js";
import { tickTenant } from "../src/tick.js";
import { DATABASE_URL, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";

const CREW = { user_id: "u_crew", name: "Demo Crew" };

const draft = (o: Partial<Draft> = {}): Draft => ({
  level: "info",
  full_screen: false,
  title_text: "Pizza is here",
  body_text: "Pick up at {place}",
  variables: { place: "the café" },
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

const overrides = (events: Event[], type: string) =>
  events.filter((e) => e.type === type).map((e) => e.data.override as Record<string, unknown>);

const ITEM = {
  id: "it_semis",
  title: "Demo Game Cup, semis",
  kind: "tournament",
  visibility: "public",
  status: "scheduled",
  location: "Stage",
  starts_at: "2026-01-01T19:00:00Z",
  ends_at: "2026-01-01T20:00:00Z",
};

describe.skipIf(!DATABASE_URL)("announcements", () => {
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
      `TRUNCATE moments, moment_overrides, moment_placements, moments_zones, moments_history,
        moments_outbox, moments_announcements, moments_sources, moments_sound_zones,
        moments_sound_log, moments_tenants`,
    );
    w = world(pool);
    await w.tx("demo", async (c) => {
      await addZone(c, "main");
      await addZone(c, "entrance");
    });
  });

  const send = (o: Partial<Draft> = {}, at = w.now) =>
    w.tx("demo", (c) => compose(c, w.engine, draft(o), CREW, at));
  const tick = (at: Date) => w.tx("demo", (c) => tickTenant(c, w.engine, at));
  const row = async (id: string) =>
    (await w.tx("demo", (c) => lockAnnouncement(c, id))) as NonNullable<
      Awaited<ReturnType<typeof lockAnnouncement>>
    >;

  it("an info card takes the rail, else the ticker, with its cue and the .sent event", async () => {
    const a = await send();
    expect(a.status).toBe("live");
    expect(a.title).toBe("Pizza is here");
    expect(a.body).toBe("Pick up at the café");
    const events = w.events("demo");
    const [card] = overrides(events, "moments.override.started");
    expect(card).toMatchObject({
      template: "announcement",
      regions: ["rail", "ticker"],
      rank: 80,
      content: {
        title: "Pizza is here",
        body: "Pick up at the café",
        level: "info",
        updated: false,
      },
    });
    const sent = events.find((e) => e.type === "moments.announcement.sent");
    expect(sent?.data).toMatchObject({
      id: a.id,
      level: "info",
      urgent: false,
      full_screen: false,
      title: "Pizza is here",
      visibility: "public",
      actor_user_id: "u_crew",
    });
    expect(events.some((e) => e.type === "moments.sound.played")).toBe(true);
  });

  it("an urgent card may take the hero before the ticker, and marks the event urgent", async () => {
    await send({ level: "urgent" });
    const events = w.events("demo");
    expect(overrides(events, "moments.override.started")[0]?.regions).toEqual([
      "rail",
      "hero",
      "ticker",
    ]);
    expect(events.find((e) => e.type === "moments.announcement.sent")?.data.urgent).toBe(true);
  });

  it("full screen takes the full region first, then degrades along its level's chain", async () => {
    await send({ full_screen: true });
    const [card] = overrides(w.events("demo"), "moments.override.started");
    expect(card?.regions).toEqual(["full", "rail", "ticker"]);
    // The theme's look, ranked as an announcement: never the emergency's.
    expect(card).toMatchObject({ rank: 80, content: { level: "info" } });
  });

  it("the ticker line is its own claim in the ticker role; the card carries it for L4", async () => {
    await send({ channels: { screen: true, ticker: true, discord: false, push: false } });
    const started = overrides(w.events("demo"), "moments.override.started");
    const line = started.find((o) => o.template === "ticker");
    const card = started.find((o) => o.template === "announcement");
    expect(line).toMatchObject({
      regions: ["ticker"],
      content: { text: "Pizza is here · Pick up at the café", source: "moments", updated: false },
    });
    expect((card?.content as Record<string, unknown>).ticker_line).toBe(
      "Pizza is here · Pick up at the café",
    );
    // The card starts later, so it wins the ticker role where it degrades there itself.
    expect(Date.parse(card?.starts_at as string)).toBeGreaterThan(
      Date.parse(line?.starts_at as string),
    );
  });

  it("two senders at once both run (E3)", async () => {
    const a = await send();
    const b = await send({ title_text: "Lost and found", body_text: "", variables: {} });
    expect([a.status, b.status]).toEqual(["live", "live"]);
    expect(overrides(w.events("demo"), "moments.override.started")).toHaveLength(2);
  });

  it("an edit changes card and line in place, with Updated for 60 s and no new sound", async () => {
    const a = await send({ channels: { screen: true, ticker: true, discord: false, push: false } });
    const before = w.events("demo").length;
    await w.tx("demo", async (c) =>
      editAnnouncement(
        c,
        w.engine,
        (await lockAnnouncement(c, a.id)) as NonNullable<
          Awaited<ReturnType<typeof lockAnnouncement>>
        >,
        {
          title_text: "Pizza is here",
          body_text: "Now at {place}",
          variables: { place: "the desk" },
        },
        CREW,
        w.at(30),
      ),
    );
    const after = w.events("demo").slice(before);
    const changed = overrides(after, "moments.override.changed");
    expect(changed.map((o) => o.content)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: "Now at the desk", updated: true }),
        expect.objectContaining({ text: "Pizza is here · Now at the desk", updated: true }),
      ]),
    );
    expect(after.some((e) => e.type === "moments.sound.played")).toBe(false);
    expect(after.find((e) => e.type === "moments.announcement.changed")?.data).toMatchObject({
      id: a.id,
      body: "Now at the desk",
      changed: ["body"],
    });
    expect((await row(a.id)).updated_until).toEqual(w.at(90));
    // The chip goes after 60 s; the text stays.
    await tick(w.at(91));
    const gone = overrides(w.events("demo"), "moments.override.changed").at(-1);
    expect(gone?.content).toMatchObject({ updated: false });
    expect((await row(a.id)).updated_until).toBeNull();
  });

  it("a withdraw ends card and line everywhere at once, silently", async () => {
    const a = await send({ channels: { screen: true, ticker: true, discord: false, push: false } });
    const before = w.events("demo").length;
    await w.tx("demo", async (c) =>
      withdrawAnnouncement(
        c,
        w.engine,
        (await lockAnnouncement(c, a.id)) as NonNullable<
          Awaited<ReturnType<typeof lockAnnouncement>>
        >,
        { reason: "withdrawn", why: "Demo Crew withdrew it", actor: CREW },
        w.at(10),
      ),
    );
    const after = w.events("demo").slice(before);
    expect(after.filter((e) => e.type === "moments.override.ended")).toHaveLength(2);
    expect(after.some((e) => e.type === "moments.sound.played")).toBe(false);
    expect(after.find((e) => e.type === "moments.announcement.withdrawn")?.data).toMatchObject({
      id: a.id,
      reason: "withdrawn",
      actor_user_id: "u_crew",
    });
    expect((await row(a.id)).status).toBe("withdrawn");
  });

  it("at a time: nothing goes out before it; the tick sends it then, also after a restart", async () => {
    const a = await send({ when: { mode: "at", at: w.at(600).toISOString() } });
    expect(a.status).toBe("scheduled");
    expect(a.fire_at).toEqual(w.at(600));
    await tick(w.at(599));
    expect(w.events("demo").some((e) => e.type === "moments.announcement.sent")).toBe(false);
    w.restart();
    await tick(w.at(600));
    expect((await row(a.id)).status).toBe("live");
    expect(w.events("demo").filter((e) => e.type === "moments.announcement.sent")).toHaveLength(1);
  });

  it("with an item: it follows the item's delay, and fills the item when it goes out", async () => {
    await w.tx("demo", (c) => storeAgenda(c, { agenda_version: 1, items: [ITEM] }));
    const a = await send({
      title_text: "{item.title} starts in {item.starts_in}",
      body_text: "{item.location}",
      variables: {},
      item_id: ITEM.id,
      when: { mode: "item", minutes_before: 15 },
    });
    // 19:00 start, 15 minutes before: 18:45.
    expect(a.fire_at).toEqual(w.at(45 * 60));
    // Delayed by 15 minutes: it moves with the item.
    const delayed = { ...ITEM, starts_at: "2026-01-01T19:15:00Z" };
    await w.tx("demo", (c) => storeAgenda(c, { agenda_version: 2, items: [delayed] }));
    await tick(w.at(45 * 60));
    expect((await row(a.id)).status).toBe("scheduled");
    expect((await row(a.id)).fire_at).toEqual(w.at(60 * 60));
    await tick(w.at(60 * 60));
    const sent = await row(a.id);
    expect(sent.status).toBe("live");
    expect(sent.title).toBe("Demo Game Cup, semis starts in 15 minutes");
    expect(sent.body).toBe("Stage");
  });

  it("a cancelled item withdraws a scheduled one and says why; nothing goes out", async () => {
    await w.tx("demo", (c) => storeAgenda(c, { agenda_version: 1, items: [ITEM] }));
    const a = await send({ item_id: ITEM.id, when: { mode: "item", minutes_before: 15 } });
    await w.tx("demo", (c) =>
      storeAgenda(c, { agenda_version: 2, items: [{ ...ITEM, status: "cancelled" }] }),
    );
    await tick(w.at(1));
    const r = await row(a.id);
    expect(r).toMatchObject({ status: "withdrawn", end_reason: "item_cancelled" });
    expect(r.why).toContain("Demo Game Cup, semis");
    expect(w.events("demo").some((e) => e.type.startsWith("moments.announcement."))).toBe(false);
  });

  it("a removed item withdraws a live one, with the .withdrawn event", async () => {
    await w.tx("demo", (c) => storeAgenda(c, { agenda_version: 1, items: [ITEM] }));
    const a = await send({ item_id: ITEM.id });
    await w.tx("demo", (c) => storeAgenda(c, { agenda_version: 2, items: [] }));
    await tick(w.at(1));
    expect((await row(a.id)).end_reason).toBe("item_removed");
    expect(
      w.events("demo").find((e) => e.type === "moments.announcement.withdrawn")?.data.reason,
    ).toBe("item_removed");
  });

  it("ends by itself at its time with no event; ended on On air it is withdrawn", async () => {
    const a = await send({ duration_seconds: 60 });
    await tick(w.at(60));
    await tick(w.at(61));
    expect(await row(a.id)).toMatchObject({ status: "ended", end_reason: "expired" });
    expect(w.events("demo").some((e) => e.type === "moments.announcement.withdrawn")).toBe(false);

    const b = await send({}, w.at(100));
    await w.tx("demo", async (c) => {
      const m = await lockMoment(c, (await row(b.id)).card_moment_id as string);
      if (m !== null) await w.engine.end(c, m, "cleared", CREW, w.at(110));
    });
    await tick(w.at(111));
    expect(await row(b.id)).toMatchObject({ status: "withdrawn", end_reason: "ended_on_air" });
    expect(
      w.events("demo").find((e) => e.type === "moments.announcement.withdrawn")?.data.reason,
    ).toBe("ended_on_air");
  });
});
