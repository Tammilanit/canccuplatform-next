/**
 * A preview on a screen (contracts/screen.md, Zones and assignments: Preview on a screen and
 * Preview time; #444): the API, what the device and its mirrors draw, the draft key dying, and
 * every way a preview ends. On a listening server, as the push channel's tests are.
 */
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@canccu/kit";
import type { DraftTheme } from "../src/compose/sources.js";
import type { Kv } from "../src/kv.js";
import { announcePreview, endExpired, runningPreview, startPreview } from "../src/preview/store.js";
import { DATABASE_URL, call, code, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { harness } from "./helpers.js";
import { pushClient } from "./sse.js";

const KEY = "k".repeat(43);
const DRAFT: DraftTheme = {
  revision: null,
  tokens_css_url: `/theming/preview/${KEY}/tokens.css?v=4`,
  css_url: null,
  logo_url: null,
  layouts: [],
  templates: [],
};

describe.skipIf(!DATABASE_URL)("a preview on a screen", () => {
  let h: Harness;
  let client: ReturnType<typeof pushClient>;
  beforeAll(async () => {
    h = await harness();
    await h.app.listen({ host: "127.0.0.1", port: 0 });
    client = pushClient(h, (h.app.server.address() as AddressInfo).port);
    h.sources.theme = {
      revision: 7,
      tokens_css_url: "/theming/a/live.css",
      css_url: null,
      logo_url: null,
      layouts: [],
      templates: [],
    };
  });
  afterAll(async () => {
    await h.close();
  });

  const start = (id: string, body: Record<string, unknown>, session = "admin") =>
    call(h, "PUT", `/api/screen/devices/${id}/preview`, { session, body });
  const end = (id: string) =>
    call(h, "DELETE", `/api/screen/devices/${id}/preview`, { session: "admin" });
  const stateOf = async (token: string) =>
    (await call(h, "GET", "/api/screen/device/state", { cookies: { canccu_device: token } })).json<
      Record<string, unknown>
    >();
  const ahead = (minutes: number) => new Date(h.clock.now + minutes * 60_000).toISOString();

  it("is refused for a device with no zone of its own, a bad body, or without the right", async () => {
    const parked = await pairDevice(h);
    expect((await start(parked.id, { minutes: 5 })).statusCode).toBe(404);
    const { id } = await client.screen();
    expect((await start(id, { minutes: 5 }, "crew")).statusCode).toBe(403);
    for (const body of [
      {},
      { minutes: 0 },
      { minutes: 61 },
      { minutes: 5, at: ahead(-10) },
      { minutes: 5, at: ahead(15 * 24 * 60) },
      { minutes: 5, theme_preview_key: "short" },
      { minutes: 5, zone: { key: "other", name: "Other" } },
      { minutes: 5, colour: "red" },
    ]) {
      const res = await start(id, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(code(res)).toBe("invalid_request");
    }
    // A key theming does not know (published, discarded or never made).
    expect(code(await start(id, { minutes: 5, theme_preview_key: KEY }))).toBe("invalid_request");
    const mirror = await pairDevice(h);
    await call(h, "PUT", `/api/screen/devices/${mirror.id}/assignment`, {
      session: "admin",
      body: { mirror_of: { device_id: id } },
    });
    expect((await start(mirror.id, { minutes: 5 })).statusCode).toBe(404);
  });

  it("draws on the device only, with its mark, no sound, and the zone's live version", async () => {
    const preview = await client.screen();
    const other = await client.screen();
    const before = await stateOf(other.token);
    const res = await start(preview.id, {
      minutes: 5,
      zone: { key: "main", name: "Main", layout_id: "dashboard" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      device_id: preview.id,
      zone_key: "main",
      until: ahead(5),
      at: null,
      theme: false,
      started_by: "u_admin",
    });
    const shown = await stateOf(preview.token);
    expect(shown.preview).toEqual({ until: ahead(5), at: null, theme: false });
    expect((shown.layout as { id: string }).id).toBe("dashboard");
    expect(shown.sound).toMatchObject({ enabled: false });
    expect(shown.state_version).toBe(before.state_version);
    const live = await stateOf(other.token);
    expect(live.preview).toBeUndefined();
    expect((live.layout as { id: string }).id).not.toBe("dashboard");
    const list = await call(h, "GET", "/api/screen/previews", { session: "crew" });
    expect(
      list.json<{ previews: { device_id: string }[] }>().previews.map((p) => p.device_id),
    ).toContain(preview.id);
    expect(h.audits.at(-1)).toMatchObject({
      action: "screen.preview.started",
      actor_user_id: "u_admin",
      target: { type: "device", id: preview.id },
    });
    expect((await end(preview.id)).statusCode).toBe(204);
    expect((await stateOf(preview.token)).preview).toBeUndefined();
    expect(h.audits.at(-1)).toMatchObject({
      action: "screen.preview.ended",
      actor_user_id: "u_admin",
    });
    expect((await end(preview.id)).statusCode).toBe(404);
  });

  it("reaches an open stream and its mirror as whole states, and never resumes across it", async () => {
    const { id, token } = await client.screen();
    const mirror = await pairDevice(h);
    await call(h, "PUT", `/api/screen/devices/${mirror.id}/assignment`, {
      session: "admin",
      body: { mirror_of: { device_id: id } },
    });
    client.pump();
    const sse = client.open(token);
    const watcher = client.open(mirror.token);
    const first = await sse.next("state");
    await watcher.next("state");
    await start(id, { minutes: null });
    const previewing = await sse.next("state");
    expect(previewing.data.preview).toEqual({ until: null, at: null, theme: false });
    expect((await watcher.next("state")).data.preview).toMatchObject({ until: null });
    // A change of the zone while it runs comes as a whole state, composed from the preview.
    await call(h, "PUT", "/api/screen/ticker", {
      session: "admin",
      body: { text: "Doors close at ten", until: null },
    });
    client.pump();
    const changed = await sse.next();
    expect(changed.event).toBe("state");
    expect(changed.data.preview).not.toBeNull();
    sse.close();
    await sse.ended;
    // The id it last had is the live zone's: a resume now would hand it the live changes.
    const again = client.open(token, first.id);
    expect((await again.next()).event).toBe("state");
    await end(id);
    const ended = await again.next("state");
    expect(ended.data.preview).toBeUndefined();
    // The mirror drew the ticker's change in the preview too; then the live zone again.
    let last = await watcher.next("state");
    while (last.data.preview !== undefined) last = await watcher.next("state");
    expect(last.data.preview).toBeUndefined();
    again.close();
    watcher.close();
  });

  it("draws the draft with the revision in effect, and drops it once the key dies", async () => {
    const { id, token } = await client.screen();
    h.sources.drafts[KEY] = { ...DRAFT };
    const res = await start(id, { minutes: 10, theme_preview_key: KEY });
    expect(res.json()).toMatchObject({ theme: true });
    const shown = await stateOf(token);
    expect(shown.theme).toMatchObject({ revision: 7, tokens_css_url: DRAFT.tokens_css_url });
    expect(shown.preview).toMatchObject({ theme: true });
    // Published: theming forgets the key, and the screen draws the theme in effect.
    h.sources.drafts = {};
    const after = await stateOf(token);
    expect(after.theme).toMatchObject({ revision: 7, tokens_css_url: "/theming/a/live.css" });
    expect(after.preview).toMatchObject({ theme: false, until: ahead(10) });
    const list = await call(h, "GET", "/api/screen/previews", { session: "admin" });
    const row = list
      .json<{ previews: { device_id: string; theme: boolean }[] }>()
      .previews.find((p) => p.device_id === id);
    expect(row?.theme).toBe(false);
  });

  it("draws the draft once a failed draft read succeeds at the stream's next minute", async () => {
    const { id, token } = await client.screen();
    h.sources.drafts[KEY] = { ...DRAFT };
    h.sources.draftsDown = true;
    try {
      expect((await start(id, { minutes: 10, theme_preview_key: KEY })).json()).toMatchObject({
        theme: true,
      });
      const sse = client.open(token);
      const unread = await sse.next("state");
      expect(unread.data.preview).toMatchObject({ theme: false });
      h.sources.draftsDown = false;
      h.clock.now += 61_000;
      const drawn = await sse.next("state", 3_000);
      expect(drawn.data.preview).toMatchObject({ theme: true });
      expect(drawn.data.theme).toMatchObject({ tokens_css_url: DRAFT.tokens_css_url });
      sse.close();
    } finally {
      h.sources.draftsDown = false;
      await end(id);
    }
  });

  it("shows the zone at a preview time: the run of show then, the ticker as now", async () => {
    const { id, token } = await client.screen();
    h.sources.agendaItems = [
      {
        id: "a_1",
        title: "Semi-finals",
        kind: "match",
        starts_at: ahead(170),
        ends_at: ahead(230),
        delay_minutes: 0,
        location: null,
        visibility: "public",
        status: "scheduled",
        zone: null,
      },
    ];
    await start(id, { minutes: 5, at: ahead(180) });
    const shown = await stateOf(token);
    expect(shown.preview).toMatchObject({ at: ahead(180) });
    expect(JSON.stringify(shown.regions)).toContain("Semi-finals");
    const zone = await call(h, "POST", `/api/screen/zones/main/preview?at=${ahead(180)}`, {
      session: "admin",
      body: { key: "main", name: "Main" },
    });
    expect(zone.statusCode).toBe(200);
    expect(JSON.stringify(zone.json())).toContain("Semi-finals");
    const late = await call(h, "POST", `/api/screen/zones/main/preview?at=${ahead(-120)}`, {
      session: "admin",
      body: { key: "main", name: "Main" },
    });
    expect(late.statusCode).toBe(400);
    h.sources.agendaItems = null;
  });

  it("ends with a reassignment, even to the same zone, audited by the module", async () => {
    const { id, token } = await client.screen();
    await start(id, { minutes: 30 });
    await call(h, "PUT", `/api/screen/devices/${id}/assignment`, {
      session: "admin",
      body: { zone_key: "main" },
    });
    expect((await stateOf(token)).preview).toBeUndefined();
    expect(
      h.audits.find((a) => a.action === "screen.preview.ended" && a.target.id === id),
    ).toMatchObject({
      actor_user_id: null,
    });
  });

  it("ends by itself at `until`, and the tick removes it with the module as actor", async () => {
    const { id, token } = await client.screen();
    await start(id, { minutes: 1 });
    h.clock.now += 61_000;
    expect((await stateOf(token)).preview).toBeUndefined();
    const ended = await withTenant("alpha", () =>
      h.db.tenant((c) =>
        endExpired(
          c,
          (entry) => {
            h.audits.push(entry);
            return Promise.resolve();
          },
          h.clock.now,
        ),
      ),
    );
    expect(ended).toContain(id);
    expect(
      await withTenant("alpha", () => h.db.tenant((c) => runningPreview(c, id, 0))),
    ).toBeNull();
    expect(h.audits.at(-1)).toMatchObject({ action: "screen.preview.ended", actor_user_id: null });
  });

  it("starts no preview on a zone the device left after the zone was read", async () => {
    const { id } = await client.screen();
    const started = await withTenant("alpha", () =>
      h.db.tenant((c) =>
        startPreview(c, {
          deviceId: id,
          zoneKey: "elsewhere",
          zone: null,
          at: null,
          themeKey: null,
          until: null,
          endsAt: new Date(h.clock.now + 60_000),
          actor: "u_admin",
        }),
      ),
    );
    expect(started).toBe(false);
    expect(
      await withTenant("alpha", () => h.db.tenant((c) => runningPreview(c, id, h.clock.now))),
    ).toBeNull();
  });

  it("logs a failed no-resume flag instead of dropping it silently", async () => {
    const warned: string[] = [];
    const kv = { set: () => Promise.reject(new Error("valkey down")) } as unknown as Kv;
    await withTenant("alpha", () =>
      announcePreview(
        {
          kv,
          fanout: { subscribe: () => () => undefined, publish: () => Promise.resolve() },
          log: { warn: (_obj: object, msg: string) => void warned.push(msg) },
        },
        "dv_x",
      ),
    );
    expect(warned).toHaveLength(1);
  });
});
