/**
 * The composer at Run the event → Announcements (mockup 05; contracts/moments.md, Announcements,
 * Pages), used as a browser does: a template, its variables, a preview of every channel before
 * Send (U11), and Edit and Withdraw beside it. On air and a run-of-show item lead to it (U5).
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AgendaItem } from "../src/scene-eval.js";
import { storeAgenda } from "../src/scene-store.js";
import { addZone } from "../src/store.js";
import { appWorld, json } from "./app.js";
import type { AppWorld } from "./app.js";
import { DATABASE_URL, freshDatabase } from "./helpers.js";

const form = { form: true };
const FIELDS = {
  idempotency_key: "page-key-0001",
  template_key: "food",
  title: "Food is here",
  body: "Pick up at {place}.",
  var_place: "the café",
  level: "info",
  ch_screen: "true",
  ch_ticker: "true",
  when: "now",
  duration_seconds: "300",
  minutes_before: "0",
};

describe.skipIf(!DATABASE_URL)("the announcement composer", () => {
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
      `TRUNCATE moments, moment_overrides, moment_placements, moments_zones, moments_history,
        moments_outbox, moments_announcements, moments_announcement_templates, moments_sources,
        moments_idempotency, moments_sound_zones, moments_sound_log, moments_tenants`,
    );
    w = await appWorld(pool);
    await w.tx("demo", async (c) => {
      await addZone(c, "main");
      await storeAgenda(c, {
        agenda_version: 1,
        items: [
          {
            id: "it_semis",
            title: "Demo Game Cup, semis",
            kind: "tournament",
            visibility: "public",
            status: "scheduled",
            location: "Stage",
            starts_at: "2026-01-01T19:45:00Z",
            ends_at: null,
          } as AgendaItem,
        ],
      });
    });
  });

  const list = async () =>
    json(await w.call("crew", "GET", "/api/moments/announcements")).announcements as {
      id: string;
      status: string;
      body: string;
    }[];

  it("opens on Run the event → Announcements with the templates and every channel", async () => {
    const page = await w.call("crew", "GET", "/announce");
    expect(page.statusCode).toBe(200);
    for (const text of [
      "New announcement",
      "Food is here",
      "Starting in 15 minutes",
      "Screen card",
      "Ticker line",
      "Discord channel",
      "Push to phones",
      "Live and scheduled",
    ])
      expect(page.body).toContain(text);
    // The menu's Announcements item is the current page.
    expect(page.body).toMatch(
      /aria-current="page"[^>]*>[\s\S]{0,400}Announcements|href="\/moments\/announce"[^>]*aria-current="page"/,
    );
    expect((await w.call("reader", "GET", "/announce")).statusCode).toBe(403);
  });

  it("a template asks for its free variables; Announce this brings the item along", async () => {
    const food = await w.call("crew", "GET", "/announce?template=food");
    expect(food.body).toContain('name="var_place"');
    const item = await w.call("crew", "GET", "/announce?item=it_semis&template=starting_soon");
    expect(item.body).toContain('<option value="it_semis" selected');
    expect(item.body).toContain("{item.title} starts in {item.starts_in}");
  });

  it("previews every channel before it may be sent, then sends it", async () => {
    const preview = await w.call("crew", "POST", "/announce", { ...FIELDS, do: "preview" }, form);
    expect(preview.statusCode).toBe(200);
    expect(preview.body).toContain("Food is here · Pick up at the café.");
    expect(preview.body).toContain("data-announce-preview");
    expect(preview.body).toContain('value="send"');
    expect(await list()).toEqual([]);
    const sent = await w.call("crew", "POST", "/announce", { ...FIELDS, do: "send" }, form);
    expect(sent.statusCode).toBe(303);
    expect(sent.headers.location).toMatch(/^\/moments\/announce\?done=/);
    expect((await list()).map((a) => a.status)).toEqual(["live"]);
  });

  it("says what is wrong and keeps what was typed; no Send until a preview passes", async () => {
    const bad = await w.call(
      "crew",
      "POST",
      "/announce",
      { ...FIELDS, title: "Food {colour.x}", do: "preview" },
      form,
    );
    expect(bad.statusCode).toBe(200);
    expect(bad.body).toContain("Unknown placeholder {colour.x}");
    expect(bad.body).toContain('value="Food {colour.x}"');
    expect(bad.body).not.toContain('value="send"');
  });

  it("schedules with a run-of-show item, minutes before its start", async () => {
    const r = await w.call(
      "crew",
      "POST",
      "/announce",
      {
        ...FIELDS,
        template_key: "starting_soon",
        title: "{item.title} starts in {item.starts_in}",
        body: "{item.location}",
        item_id: "it_semis",
        when: "item",
        minutes_before: "15",
        do: "send",
      },
      form,
    );
    expect(r.statusCode).toBe(303);
    expect((await list())[0]?.status).toBe("scheduled");
    expect((await w.call("crew", "GET", "/announce")).body).toContain("scheduled");
  });

  it("edits in place and withdraws in one tap", async () => {
    await w.call("crew", "POST", "/announce", { ...FIELDS, do: "send" }, form);
    const [a] = await list();
    const id = a?.id ?? "";
    const edit = await w.call("crew", "GET", `/announce?edit=${id}`);
    expect(edit.body).toContain("Edit announcement");
    const saved = await w.call(
      "crew",
      "POST",
      `/announce/${id}/edit`,
      {
        idempotency_key: "page-key-0002",
        title: "Food is here",
        body: "Now at {place}.",
        var_place: "the desk",
      },
      form,
    );
    expect(saved.statusCode).toBe(303);
    expect((await list())[0]?.body).toBe("Now at the desk.");
    const gone = await w.call(
      "crew",
      "POST",
      `/announce/${id}/withdraw`,
      { idempotency_key: "page-key-0003" },
      form,
    );
    expect(gone.statusCode).toBe(303);
    expect((await list())[0]?.status).toBe("withdrawn");
  });

  it("saves the form as one of the event's templates, for those who may", async () => {
    const r = await w.call(
      "admin",
      "POST",
      "/announce",
      { ...FIELDS, title: "Raffle at {time}", body: "", template_name: "Raffle", do: "template" },
      form,
    );
    expect(r.statusCode).toBe(303);
    const page = await w.call("admin", "GET", "/announce");
    expect(page.body).toContain("Raffle");
    expect(
      (await w.call("crew", "POST", "/announce", { ...FIELDS, do: "template" }, form)).headers
        .location,
    ).toMatch(/error=/);
  });

  it("On air leads the crew to Announce", async () => {
    expect((await w.call("crew", "GET", "/on-air")).body).toContain(`href="/moments/announce"`);
  });
});
