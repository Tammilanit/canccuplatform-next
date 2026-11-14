/** The energy level: the Motion card's API and `display` (contracts/screen.md, Motion and burn-in drift). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DATABASE_URL, call, code, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";
import type { AgendaItem } from "../src/compose/widgets.js";

interface Motion {
  settings_version: number;
  motion_level: string;
  follow_the_day: boolean;
  theme_motion: string;
  zones: {
    key: string;
    motion_level: string | null;
    level: string;
    phase: string;
    next: unknown;
  }[];
}

const NOON = Date.parse("2026-06-01T12:00:00Z");
const item = (kind: string, from: number, to: number | null): AgendaItem => ({
  id: `${kind}-${from}`,
  title: kind,
  kind,
  starts_at: new Date(from).toISOString(),
  ends_at: to === null ? null : new Date(to).toISOString(),
  delay_minutes: 0,
  location: null,
  visibility: "public",
  status: "scheduled",
  zone: null,
});
const H = 3600_000;

describe.skipIf(!DATABASE_URL)("the energy level", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    await call(h, "POST", "/api/screen/zones", {
      session: "admin",
      body: { key: "hall", name: "Hall" },
    });
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(() => {
    h.clock.now = NOON;
    h.sources.agenda = { current: [], next: [] };
    h.sources.agendaItems = [];
    h.sources.theme = null;
  });

  const motion = async () =>
    (await call(h, "GET", "/api/screen/motion", { session: "crew" })).json<Motion>();
  const save = (body: unknown, session = "admin", host?: string) =>
    call(h, "PUT", "/api/screen/motion", { session, body, ...(host ? { host } : {}) });
  const display = async (key: string) =>
    (await call(h, "GET", `/api/screen/zones/${key}/state`, { session: "admin" })).json<{
      display: Record<string, unknown>;
    }>().display;

  it("answers the event's defaults and each zone's level now", async () => {
    const m = await motion();
    expect(m).toMatchObject({ settings_version: 0, motion_level: "lively", follow_the_day: true });
    expect(m.theme_motion).toBe("moderate");
    expect(m.zones.find((z) => z.key === "hall")).toEqual({
      key: "hall",
      name: "Hall",
      motion_level: null,
      level: "lively",
      phase: "build_up",
      next: null,
    });
  });

  it("follows the day and names the next change within 24 hours", async () => {
    h.sources.agendaItems = [item("ceremony", NOON + 2 * H, NOON + 3 * H)];
    const hall = (await motion()).zones.find((z) => z.key === "hall");
    expect(hall?.next).toEqual({
      level: "party",
      phase: "peak",
      at: new Date(NOON + 2 * H).toISOString(),
    });
  });

  it("saves the level through admin as the person, audits it and answers the new settings", async () => {
    const before = h.audits.length;
    const res = await save({ settings_version: 0, motion_level: "party", follow_the_day: false });
    expect(res.statusCode).toBe(200);
    expect(res.json<Motion>()).toMatchObject({
      settings_version: 1,
      motion_level: "party",
      follow_the_day: false,
    });
    expect(h.settingsWrites.log.at(-1)).toMatchObject({
      actor: "u_admin",
      values: { motion_level: "party", follow_the_day: false },
    });
    expect(h.audits.slice(before)).toEqual([
      expect.objectContaining({
        action: "screen.motion.saved",
        actor_user_id: "u_admin",
        changes: {
          motion_level: { from: "lively", to: "party" },
          follow_the_day: { from: true, to: false },
        },
      }),
    ]);
    expect(await display("hall")).toMatchObject({ motion_level: "party", motion: "moderate" });
  });

  it("refuses a stale version, a bad body, a reader and an archived event", async () => {
    const version = (await motion()).settings_version;
    const stale = await save({
      settings_version: version - 1,
      motion_level: "calm",
      follow_the_day: true,
    });
    expect([stale.statusCode, code(stale)]).toEqual([409, "version_conflict"]);
    const bad = await save({
      settings_version: version,
      motion_level: "wild",
      follow_the_day: true,
    });
    expect([bad.statusCode, code(bad)]).toEqual([400, "invalid_request"]);
    const extra = await save({
      settings_version: version,
      motion_level: "calm",
      follow_the_day: true,
      x: 1,
    });
    expect(extra.statusCode).toBe(400);
    const reader = await save(
      { settings_version: version, motion_level: "calm", follow_the_day: true },
      "crew",
    );
    expect(reader.statusCode).toBe(403);
    const archived = await save(
      { settings_version: 0, motion_level: "calm", follow_the_day: true },
      "admin",
      "gamma.test",
    );
    expect([archived.statusCode, code(archived)]).toEqual([409, "event_archived"]);
  });

  it("keeps a zone's pin all day, under quiet hours and the theme", async () => {
    const zone = (await call(h, "GET", "/api/screen/zones/hall", { session: "admin" })).json<
      Record<string, unknown>
    >();
    const saved = await call(h, "PUT", "/api/screen/zones/hall", {
      session: "admin",
      body: { ...zone, motion_level: "calm" },
    });
    expect(saved.json()).toMatchObject({ motion_level: "calm" });
    expect(await display("hall")).toMatchObject({ motion_level: "calm", motion: "calm" });
    const bad = await call(h, "PUT", "/api/screen/zones/hall", {
      session: "admin",
      body: { ...saved.json<Record<string, unknown>>(), motion_level: "loud" },
    });
    expect(bad.statusCode).toBe(400);
    // Quiet hours cap the pin; the theme's `none` stills it.
    h.sources.agenda = { current: [item("quiet_hours", NOON - H, NOON + H)], next: [] };
    h.sources.theme = {
      revision: 3,
      tokens: { motion: "none", motion_style: { pack: "arcade" } },
      tokens_css_url: "/t.css",
      css_url: null,
      logo_url: null,
      layouts: [],
      templates: [],
    };
    const shown = await display("hall");
    expect(shown).toMatchObject({ motion_level: "none", motion: "none" });
    expect(shown.motion_style).toEqual({
      speed: "normal",
      intensity: "normal",
      spotlight: "glow_and_trace",
      pack: "arcade",
    });
    expect((await motion()).zones.find((z) => z.key === "hall")).toMatchObject({
      motion_level: "calm",
      level: "none",
    });
  });

  it("draws the Motion card on Zones and layouts, with the line for each zone", async () => {
    h.sources.agendaItems = [item("ceremony", NOON + 9 * H, NOON + 10 * H)];
    const page = (session: string) =>
      call(h, "GET", "/admin/screen/zones", { session }).then((r) => r.body);
    const body = await page("admin");
    expect(body).toContain('<h2 class="canccu-card__title">Motion</h2>');
    expect(body).toContain("Glow and tracing border");
    expect(body).toContain('/admin/screen/static/studio-motion.js"');
    expect(body).toContain("Right now: Hall is Calm (build-up).");
    expect(body).toMatch(/<option value="calm" selected[^>]*>Always Calm<\/option>/);
    expect(body).toContain("Save motion");
  });
});
