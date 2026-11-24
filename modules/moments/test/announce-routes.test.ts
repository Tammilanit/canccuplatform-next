/**
 * The announcements API (contracts/moments.md, Announcements; moments/announcements.openapi.yaml):
 * who may send, validation that never lets a placeholder show raw, the preview of each channel,
 * idempotent crew actions, edit and withdraw, the templates and the audit.
 */
import type pg from "pg";
import type { Event } from "@canccu/kit";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AgendaItem } from "../src/scene-eval.js";
import { handlePlatformEvent, handleTenantEvent } from "../src/consumer.js";
import { storeAgenda } from "../src/scene-store.js";
import { addZone } from "../src/store.js";
import { appWorld, errorOf, idOf, json } from "./app.js";
import type { AppWorld } from "./app.js";
import { DATABASE_URL, freshDatabase } from "./helpers.js";

const BASE = {
  title: "Pizza is here",
  body: "Pick up at {place}",
  level: "info",
  variables: { place: "the café" },
};

describe.skipIf(!DATABASE_URL)("the announcements API", () => {
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
      await addZone(c, "entrance");
    });
  });

  const post = (who: string, body: unknown, key?: string) =>
    w.call(who, "POST", "/api/moments/announcements", body, key === undefined ? {} : { key });

  it("anyone with moments.announce sends, at either level (U3); others may not", async () => {
    const info = await post("crew", BASE);
    expect(info.statusCode).toBe(201);
    expect(json(info)).toMatchObject({ status: "live", title: "Pizza is here", level: "info" });
    expect((await post("crew", { ...BASE, level: "urgent" })).statusCode).toBe(201);
    expect((await post("reader", BASE)).statusCode).toBe(403);
    expect((await w.call("reader", "GET", "/api/moments/announcements")).statusCode).toBe(403);
    // `emergency` is Emergency's own flow, not a level here.
    expect((await post("crew", { ...BASE, level: "emergency" })).statusCode).toBe(400);
  });

  it("is audited, with who sent what on which channels", async () => {
    const r = await post("crew", { ...BASE, channels: { push: true } });
    expect(w.audit.at(-1)).toMatchObject({
      tenant_id: "demo",
      actor_user_id: "u_crew",
      action: "moments.announcement.sent",
      target: { type: "announcement", id: idOf(r) },
    });
    expect(JSON.stringify(w.audit.at(-1)?.changes)).toContain("push");
  });

  it("a retry with the same key sends nothing twice (E18)", async () => {
    const a = await post("crew", BASE, "same-key-0001");
    const b = await post("crew", BASE, "same-key-0001");
    expect(idOf(b)).toBe(idOf(a));
    const list = json(await w.call("crew", "GET", "/api/moments/announcements"));
    expect(list.announcements).toHaveLength(1);
  });

  it("refuses what would show a placeholder raw, or break the limits, naming it", async () => {
    const unknown = await post("crew", { ...BASE, title: "Hi {colour.x}" });
    expect(unknown.statusCode).toBe(400);
    expect(String(errorOf(unknown).message)).toContain("{colour.x}");
    const missing = await post("crew", { ...BASE, variables: {} });
    expect(String(errorOf(missing).message)).toContain("{place}");
    const noItem = await post("crew", { ...BASE, title: "{item.title} soon" });
    expect(String(errorOf(noItem).message)).toContain("run-of-show item");
    const long = await post("crew", {
      ...BASE,
      title: "{place}",
      variables: { place: "x".repeat(61) },
    });
    expect(long.statusCode).toBe(400);
    expect(String(errorOf(long).message)).toMatch(/60/);
    const unknownItem = await post("crew", { ...BASE, item_id: "it_nope" });
    expect(unknownItem.statusCode).toBe(400);
    // #611: a free variable named after an Object.prototype key is asked for, not a 500.
    const proto = await post("crew", { ...BASE, title: "At {constructor}", variables: {} });
    expect(proto.statusCode).toBe(400);
    expect(String(errorOf(proto).message)).toContain("Fill in {constructor}");
  });

  it("previews every channel as it would go out, and saves nothing (U11)", async () => {
    const r = await w.call("crew", "POST", "/api/moments/announcements/preview", {
      ...BASE,
      level: "urgent",
      channels: { screen: true, ticker: true, discord: true, push: true },
    });
    expect(r.statusCode).toBe(200);
    expect(json(r)).toEqual({
      title: "Pizza is here",
      body: "Pick up at the café",
      regions: ["rail", "hero", "ticker"],
      line: "Pizza is here · Pick up at the café",
      push: { title: "Pizza is here", body: "Pick up at the café", urgent: true },
      discord: { text: "Pizza is here\nPick up at the café" },
      zones: ["entrance", "main"],
    });
    const off = json(
      await w.call("crew", "POST", "/api/moments/announcements/preview", {
        ...BASE,
        channels: { screen: false, discord: true },
        zones: ["main"],
      }),
    );
    expect(off).toMatchObject({ regions: [], line: null, push: null, zones: ["main"] });
    const none = await w.call("crew", "POST", "/api/moments/announcements/preview", {
      ...BASE,
      channels: { screen: false },
    });
    expect(errorOf(none).message).toBe("Choose at least one channel.");
    const list = json(await w.call("crew", "GET", "/api/moments/announcements"));
    expect(list.announcements).toEqual([]);
  });

  it("fills the item's placeholders from the run of show", async () => {
    await w.tx("demo", (c) =>
      storeAgenda(c, {
        agenda_version: 1,
        items: [
          {
            id: "it_1",
            title: "Demo Game Cup, semis",
            kind: "tournament",
            visibility: "public",
            location: "Stage",
            starts_at: new Date(w.now.getTime() + 15 * 60_000).toISOString(),
            ends_at: null,
          } as AgendaItem,
        ],
      }),
    );
    const r = await post("crew", {
      title: "{item.title} starts in {item.starts_in}",
      body: "{item.location}",
      level: "info",
      item_id: "it_1",
    });
    expect(json(r)).toMatchObject({
      title: "Demo Game Cup, semis starts in 15 minutes",
      body: "Stage",
    });
  });

  it("a crew item stays with crew readers: hidden from others, never printed publicly", async () => {
    await w.tx("demo", (c) =>
      storeAgenda(c, {
        agenda_version: 1,
        items: [
          {
            id: "it_crew",
            title: "Load-in plan",
            kind: "other",
            visibility: "crew",
            location: "Back dock",
            starts_at: new Date(w.now.getTime() + 15 * 60_000).toISOString(),
            ends_at: null,
          } as AgendaItem,
        ],
      }),
    );
    const leak = {
      title: "{item.title}",
      body: "{item.location}",
      level: "info",
      item_id: "it_crew",
    };
    const preview = (who: string, b: unknown) =>
      w.call(who, "POST", "/api/moments/announcements/preview", b);
    // Without agenda.crew.read it answers like a missing item, on preview and on send.
    for (const r of [await preview("crew", leak), await post("crew", leak)]) {
      expect(r.statusCode).toBe(400);
      expect(errorOf(r).message).toBe("No such run-of-show item.");
    }
    // A crew reader may time an announcement by it, but its fields never go out as public.
    expect(errorOf(await post("stagehand", leak)).message).toMatch(/not public/);
    expect((await post("stagehand", { ...BASE, item_id: "it_crew" })).statusCode).toBe(201);
    // The composer's picker lists it only for the crew reader.
    const picker = (who: string) => w.call(who, "GET", "/announce").then((r) => r.body);
    expect(await picker("stagehand")).toContain("Load-in plan");
    expect(await picker("crew")).not.toContain("Load-in plan");
  });

  it("schedules at a time, at most 14 days ahead", async () => {
    const at = new Date(w.now.getTime() + 3600_000).toISOString();
    const r = await post("crew", { ...BASE, when: { mode: "at", at } });
    expect(json(r)).toMatchObject({ status: "scheduled", fire_at: at, title: null });
    const far = new Date(w.now.getTime() + 15 * 86_400_000).toISOString();
    expect((await post("crew", { ...BASE, when: { mode: "at", at: far } })).statusCode).toBe(400);
    expect((await post("crew", { ...BASE, when: { mode: "item" } })).statusCode).toBe(400);
  });

  it("refuses a time in the past instead of sending it at once under Scheduled", async () => {
    const past = new Date(w.now.getTime() - 60_000).toISOString();
    const r = await post("crew", { ...BASE, when: { mode: "at", at: past } });
    expect(r.statusCode).toBe(400);
    expect(String(errorOf(r).message)).toContain("past");
    const list = json(await w.call("crew", "GET", "/api/moments/announcements"));
    expect(list.announcements).toHaveLength(0);
  });

  it("the withdraw audit records the status it really had, scheduled or live", async () => {
    const at = new Date(w.now.getTime() + 3600_000).toISOString();
    const later = idOf(await post("crew", { ...BASE, when: { mode: "at", at } }));
    await w.call("crew", "POST", `/api/moments/announcements/${later}/withdraw`, {});
    expect(w.audit.at(-1)?.changes).toEqual({ status: { old: "scheduled", new: "withdrawn" } });
    const live = idOf(await post("crew", BASE));
    await w.call("crew", "POST", `/api/moments/announcements/${live}/withdraw`, {});
    expect(w.audit.at(-1)?.changes).toEqual({ status: { old: "live", new: "withdrawn" } });
  });

  it("edits in place and withdraws once; an ended one is not running", async () => {
    const id = idOf(await post("crew", BASE));
    const edit = await w.call("crew", "PATCH", `/api/moments/announcements/${id}`, {
      title: "Pizza is here",
      body: "Now at {place}",
      variables: { place: "the desk" },
    });
    expect(edit.statusCode).toBe(200);
    expect(json(edit)).toMatchObject({ body: "Now at the desk" });
    expect(typeof json(edit).updated_until).toBe("string");
    expect(w.audit.at(-1)?.action).toBe("moments.announcement.changed");
    const bad = await w.call("crew", "PATCH", `/api/moments/announcements/${id}`, { title: "{x}" });
    expect(bad.statusCode).toBe(400);
    const gone = await w.call("crew", "POST", `/api/moments/announcements/${id}/withdraw`, {});
    expect(json(gone)).toMatchObject({ status: "withdrawn", end_reason: "withdrawn" });
    expect(w.audit.at(-1)?.action).toBe("moments.announcement.withdrawn");
    const again = await w.call("crew", "POST", `/api/moments/announcements/${id}/withdraw`, {});
    expect(errorOf(again).code).toBe("not_running");
    expect(
      (await w.call("crew", "POST", "/api/moments/announcements/an_nope/withdraw", {})).statusCode,
    ).toBe(404);
  });

  it("refuses writes on an archived event", async () => {
    const r = await post("crew", BASE);
    expect(r.statusCode).toBe(201);
    const archived = await w.call("crew", "POST", "/api/moments/announcements", BASE, {
      host: "archived.test",
    });
    expect(errorOf(archived).code).toBe("event_archived");
  });

  it("templates: the built-ins with their free variables, and the event's own", async () => {
    const list = json(await w.call("crew", "GET", "/api/moments/announcement-templates"));
    const food = (list.templates as Record<string, unknown>[]).find((t) => t.key === "food");
    expect(food).toMatchObject({ builtin: true, variables: ["place"] });
    const put = (who: string, key: string, body: unknown) =>
      w.call(who, "PUT", `/api/moments/announcement-templates/${key}`, body);
    const mine = {
      name: "Raffle",
      title: "Raffle at {time}",
      body: "",
      level: "info",
      revision: 0,
    };
    expect((await put("crew", "raffle", mine)).statusCode).toBe(403);
    const saved = await put("admin", "raffle", mine);
    expect(saved.statusCode).toBe(200);
    expect(json(saved)).toMatchObject({
      key: "raffle",
      builtin: false,
      variables: ["time"],
      revision: 1,
    });
    expect(w.audit.at(-1)?.action).toBe("moments.announcement_template.saved");
    expect((await put("admin", "raffle", mine)).statusCode).toBe(409);
    expect((await put("admin", "food", { ...mine, revision: 1 })).statusCode).toBe(400);
    expect((await put("admin", "oops", { ...mine, title: "{item.nope}" })).statusCode).toBe(400);
    const del = await w.call("admin", "DELETE", "/api/moments/announcement-templates/raffle");
    expect(del.statusCode).toBe(204);
    expect(
      (await w.call("admin", "DELETE", "/api/moments/announcement-templates/food")).statusCode,
    ).toBe(400);
  });
  it("clone copies the event's own templates; deletes take the rows and the names", async () => {
    await w.call("admin", "PUT", "/api/moments/announcement-templates/raffle", {
      name: "Raffle",
      title: "Raffle at {time}",
      level: "info",
      revision: 0,
    });
    const id = idOf(await post("crew", BASE));
    // Another user withdraws it: their name is not kept in the reason.
    expect(
      (await w.call("admin", "POST", `/api/moments/announcements/${id}/withdraw`)).statusCode,
    ).toBe(200);
    const deps = { db: w.db, engine: w.engine, flush: () => w.outbox.flush(), now: () => w.now };
    const ev = (type: string, data: Record<string, unknown>, tenant?: string): Event => ({
      id: "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4e98",
      type,
      version: 1,
      time: w.now.toISOString(),
      source: "tenants",
      data,
      ...(tenant === undefined ? {} : { tenant }),
    });
    const cloned = ev("tenants.tenant.cloned", { source_tenant_id: "demo" }, "two");
    await w.tx("two", () => handleTenantEvent(deps, cloned));
    await w.tx("two", () => handleTenantEvent(deps, cloned));
    const two = json(
      await w.call("crew", "GET", "/api/moments/announcement-templates", undefined, {
        host: "two.test",
      }),
    );
    expect((two.templates as { key: string }[]).filter((t) => t.key === "raffle")).toHaveLength(1);
    // A deleted person's name leaves the announcements they sent.
    await handlePlatformEvent(deps, ev("tenants.user.deleted", { user_id: "u_crew" }));
    const mine = (
      json(await w.call("crew", "GET", "/api/moments/announcements")).announcements as {
        id: string;
        actor: unknown;
      }[]
    ).find((a) => a.id === id);
    expect(mine?.actor).toBeNull();
    await handlePlatformEvent(deps, ev("tenants.user.deleted", { user_id: "u_admin" }));
    const rows = await pool.query<{ why: string | null }>(
      `SELECT why FROM moments_announcements WHERE id = $1`,
      [id],
    );
    expect(rows.rows[0]?.why ?? "").not.toContain("admin");
    await handlePlatformEvent(deps, ev("tenants.tenant.deleted", { tenant_id: "demo" }));
    const left = await pool.query(
      `SELECT (SELECT count(*) FROM moments_announcements WHERE tenant_id = 'demo')::int AS a,
        (SELECT count(*) FROM moments_announcement_templates WHERE tenant_id = 'demo')::int AS t`,
    );
    expect(left.rows[0]).toEqual({ a: 0, t: 0 });
  });
});
