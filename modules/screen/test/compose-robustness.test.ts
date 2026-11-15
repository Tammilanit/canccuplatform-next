/**
 * Compose and kiosk loader robustness (#547): a late duplicate agenda event never rolls a row back,
 * a claim's end rebuilds its zone, one failed read of the pinned theme keeps the pinned look, a
 * database blip still serves the kiosk loader, and one failing tick step never lets ticks overlap.
 */
import { newId, withTenant } from "@canccu/kit";
import type { Event } from "@canccu/kit";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyAgendaEvent, loadAgendaItems, loadAgendaLabels } from "../src/content/agenda.js";
import { applyOverrideEvent } from "../src/compose/overrides.js";
import type { ThemeNow } from "../src/compose/sources.js";
import { noSources } from "../src/compose/sources.js";
import { themeFor } from "../src/pins/look.js";
import type { PinValues } from "../src/pins/store.js";
import { refreshZone } from "../src/push/device-state.js";
import { MemoryFanout, MemoryZoneStore } from "../src/push/store.js";
import { serialTick } from "../src/tick/serial.js";
import { DATABASE_URL, call, context, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

const theme = (revision: number, logo: string) =>
  ({ revision, logo_url: logo }) as unknown as ThemeNow;
const pin = (theme_revision: number | null) =>
  ({ theme_revision, bundle_version: null }) as unknown as PinValues;

describe("the pinned look", () => {
  it("keeps the last good pinned revision through a failed read, per event and revision", async () => {
    let answer: ThemeNow | "gone" | null = theme(3, "/pinned.png");
    const sources = {
      theme: () => Promise.resolve(theme(9, "/current.png")),
      themeRevision: () => Promise.resolve(answer),
    };
    expect((await themeFor(sources, "t_look", pin(3)))?.logo_url).toBe("/pinned.png");
    answer = null;
    expect((await themeFor(sources, "t_look", pin(3)))?.logo_url).toBe("/pinned.png");
    // Nothing good was read yet for another event or another revision: the current look.
    expect((await themeFor(sources, "t_other", pin(3)))?.logo_url).toBe("/current.png");
    expect((await themeFor(sources, "t_look", pin(4)))?.logo_url).toBe("/current.png");
    // A revision theming no longer has is gone for good, not a blip.
    answer = "gone";
    expect((await themeFor(sources, "t_look", pin(3)))?.logo_url).toBe("/current.png");
    answer = null;
    expect((await themeFor(sources, "t_look", pin(3)))?.logo_url).toBe("/current.png");
  });
});

describe("the tick", () => {
  it("never overlaps while a step runs, though another step failed, and logs each failure", async () => {
    let finish = () => {};
    const slow = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const failing = vi.fn(() => Promise.reject(new Error("db down")));
    const log = { warn: vi.fn() };
    const run = serialTick({ zones: failing, pins: slow }, log);
    const first = run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await run();
    expect(slow).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]?.[0]).toMatchObject({ step: "zones" });
    expect(log.warn.mock.calls[0]?.[1]).toBe("screen tick failed");
    const next = run();
    expect(slow).toHaveBeenCalledTimes(2);
    finish();
    await next;
  });
});

describe.skipIf(!DATABASE_URL)("compose and the kiosk loader", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    await call(h, "GET", "/api/screen/zones", { session: "admin" });
  });
  afterAll(async () => {
    await h.close();
  });

  const agenda = (type: string, item: Record<string, unknown>, version?: number): Event => ({
    id: newId(),
    type,
    version: 1,
    time: "2026-01-01T00:00:00Z",
    source: "agenda",
    tenant: "alpha",
    data: version === undefined ? { item } : { item, agenda_version: version },
  });
  const apply = (e: Event) => withTenant("alpha", () => applyAgendaEvent(h.db, e));

  it("keeps what started wrote when the added event it followed comes again", async () => {
    const added = {
      id: "it_dup",
      title: null,
      visibility: null,
      starts_at: "2026-01-01T18:00:00Z",
      ends_at: "2026-01-01T19:00:00Z",
      status: "scheduled",
      revision: 1,
    };
    await apply(agenda("agenda.item.added", added, 7));
    const started = { ...added, starts_at: "2026-01-01T18:10:00Z", revision: 2 };
    await apply(agenda("agenda.item.started", started));
    // The replay brings the added event again, now with the title and visibility it had.
    await apply(agenda("agenda.item.added", { ...added, title: "Quiz", visibility: "public" }, 7));
    const items = await withTenant("alpha", () => h.db.tenant(loadAgendaItems));
    expect(items.get("it_dup")?.startsAt.toISOString()).toBe("2026-01-01T18:10:00.000Z");
    const labels = await withTenant("alpha", () => h.db.tenant(loadAgendaLabels));
    expect(labels.get("it_dup")).toEqual({ title: "Quiz", crew: false });
  });

  it("rebuilds the zone when a claim ends, so a grown hero shrinks back", async () => {
    h.clock.now = Date.parse("2026-01-01T12:01:00Z");
    await withTenant("alpha", () =>
      applyOverrideEvent(h.db, {
        id: newId(),
        type: "moments.override.started",
        version: 1,
        time: new Date(h.clock.now).toISOString(),
        source: "moments",
        tenant: "alpha",
        data: {
          actor_user_id: null,
          override: {
            id: "ov_end",
            kind: "block",
            zones: ["main"],
            rank: 80,
            source: { module: "moments", event_id: null, ref: null },
            template: "announcement",
            content: {
              title: "Dinner",
              body: "",
              level: "info",
              starts_at: "2026-01-01T12:00:00Z",
            },
            regions: ["rail"],
            ttl_seconds: 300,
            sound: null,
            steps: null,
            on_end: "resume",
            starts_at: "2026-01-01T12:00:00Z",
            ends_at: null,
          },
        },
      }),
    );
    const deps = {
      db: h.db,
      kv: h.kv,
      sources: noSources,
      settings: { ensure: () => Promise.resolve(), get: (_k: string, f: unknown) => f },
      bundleVersion: "test",
      bundles: { available: () => Promise.resolve(["test"]) },
      zones: new MemoryZoneStore(new MemoryFanout()),
      now: () => h.clock.now,
    } as Parameters<typeof refreshZone>[0];
    const record = await withTenant("alpha", () =>
      refreshZone(deps, context("alpha"), "alpha.test", "main"),
    );
    expect(record?.nextChangeAt).toBe(Date.parse("2026-01-01T12:05:00Z"));
  });

  it("serves the kiosk loader with the platform's bundle when the pin cannot be read", async () => {
    const tenant = h.db.tenant.bind(h.db);
    h.db.tenant = () => Promise.reject(new Error("connection terminated"));
    try {
      const res = await call(h, "GET", "/screen/");
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('data-bundle="test"');
    } finally {
      h.db.tenant = tenant;
    }
  });
});
