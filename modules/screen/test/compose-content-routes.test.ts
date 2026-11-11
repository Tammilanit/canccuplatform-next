/**
 * The content widgets in a device's composed state (#308): each read from its source only for a
 * zone that shows it, so another zone's `state_version` never moves with a playlist or a code.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readAssets } from "../src/assets/reader.js";
import { tickRunner } from "../src/tick/run.js";
import {
  DATABASE_URL,
  TENANTS,
  call,
  context,
  harness,
  pairDevice,
  png,
  upload,
} from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Widget {
  widget: string;
  view: Record<string, unknown>;
}
interface State {
  state_version: number;
  regions: { id: string; widgets: Widget[] }[];
}

const CODE = {
  purpose: "arrival",
  code: "abcdefghijklmnopqrstuv",
  url: "/notify/check-in?p=arrival&c=abcdefghijklmnopqrstuv",
  valid_until: "2026-01-01T12:01:00Z",
  rotates_at: "2026-01-01T12:00:30Z",
};

describe.skipIf(!DATABASE_URL)("the content widgets", () => {
  let h: Harness;
  beforeAll(async () => {
    TENANTS["alpha.test"] = context("alpha", { flags: { "screen.photos": true } });
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(() => {
    h.sources.event = { name: "Demo Event" };
    h.sources.checkin = CODE;
  });

  const admin = { host: "alpha.test", session: "admin" };
  const state = async (token: string) =>
    (
      await call(h, "GET", "/api/screen/device/state", {
        host: "alpha.test",
        cookies: { canccu_device: token },
      })
    ).json<State>();
  const widget = (s: State, type: string) =>
    s.regions.flatMap((r) => r.widgets).find((w) => w.widget === type);
  const placed = async (zone: string) => {
    const { id, token } = await pairDevice(h);
    await call(h, "GET", "/api/screen/zones", admin);
    const res = await call(h, "PUT", `/api/screen/devices/${id}/assignment`, {
      ...admin,
      body: { zone_key: zone },
    });
    expect(res.statusCode).toBe(200);
    return token;
  };
  const tick = () =>
    tickRunner({
      db: h.db,
      kv: h.kv,
      bus: h.bus,
      audit: () => Promise.resolve(),
      settings: { ensure: () => Promise.resolve(), get: (_key, fallback) => fallback },
      assets: readAssets,
      tenantById: (id) =>
        Promise.resolve(Object.values(TENANTS).find((t) => t.tenant_id === id) ?? null),
      now: () => h.clock.now,
    })();

  it("plays a pushed image in the playlist widget, from the tick's position", async () => {
    const token = await placed("main");
    const asset = await upload(h, "/api/screen/assets", await png(7), "slide.png", admin);
    expect(asset.statusCode).toBe(201);
    const { id, url } = asset.json<{ id: string; url: string }>();
    const until = new Date(h.clock.now + 3_600_000).toISOString();
    const push = await call(h, "POST", "/api/screen/push", {
      ...admin,
      body: { zones: ["main"], asset_id: id, until },
    });
    expect(push.statusCode).toBe(201);
    await tick();
    const view = widget(await state(token), "playlist")?.view;
    expect(view).toMatchObject({
      empty: false,
      item: { kind: "image", url, started_at: new Date(h.clock.now).toISOString() },
    });
  });

  it("shows the carousel's photo in the photo widget", async () => {
    const token = await placed("main");
    const res = await upload(h, "/api/screen/photos", await png(8), "party.png", {
      ...admin,
      fields: { posted_at: "2026-01-01T11:59:00.000Z", caption: "Party" },
    });
    expect(res.statusCode).toBe(201);
    const view = widget(await state(token), "photo")?.view;
    expect(view).toMatchObject({
      empty: false,
      caption: "Party",
      url: res.json<{ url: string }>().url,
    });
  });

  it("reads the check-in code only for a zone that shows it", async () => {
    const plain = await placed("main");
    h.sources.checkinReads.length = 0;
    await state(plain);
    expect(h.sources.checkinReads).toEqual([]);

    const made = await call(h, "POST", "/api/screen/zones", {
      ...admin,
      body: {
        key: "door",
        name: "Door",
        regions: { hero: { widgets: [{ widget: "checkin_qr" }] } },
      },
    });
    expect(made.statusCode).toBe(201);
    const door = await placed("door");
    const view = widget(await state(door), "checkin_qr")?.view;
    expect(h.sources.checkinReads).toContain("arrival");
    expect(view).toMatchObject({ purpose: "arrival", url: `https://alpha.test${CODE.url}` });
  });

  it("moves the zone's version when the code rotates, and not before", async () => {
    const door = await placed("door");
    const first = await state(door);
    expect((await state(door)).state_version).toBe(first.state_version);
    h.sources.checkin = { ...CODE, code: "zzzzzzzzzzzzzzzzzzzzzz", url: "/notify/check-in?c=z" };
    expect((await state(door)).state_version).toBe(first.state_version + 1);
  });
});
