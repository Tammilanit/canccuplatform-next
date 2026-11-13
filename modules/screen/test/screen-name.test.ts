/** The header's zone name (contracts/screen.md, Header and hub QR, `screen_name`; sheet 16). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, call, code, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Zone {
  zone: { key: string; name: string; show_name?: boolean };
  state_version: number;
}

describe.skipIf(!DATABASE_URL)("screen_name", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    for (const key of ["hall", "bar"]) {
      await call(h, "POST", "/api/screen/zones", { session: "admin", body: { key, name: key } });
    }
  });
  afterAll(async () => {
    await h.close();
  });

  const state = async (key: string) =>
    (await call(h, "GET", `/api/screen/zones/${key}/state`, { session: "admin" })).json<Zone>();
  const assign = (id: string, body: unknown) =>
    call(h, "PUT", `/api/screen/devices/${id}/assignment`, { session: "admin", body });
  const setName = async (key: string, screenName: string) => {
    const zone = (await call(h, "GET", `/api/screen/zones/${key}`, { session: "admin" })).json<{
      revision: number;
    }>();
    return call(h, "PUT", `/api/screen/zones/${key}`, {
      session: "admin",
      body: { ...zone, screen_name: screenName },
    });
  };

  it("hides the name with one screen and shows it from two, on every zone, moving the version", async () => {
    expect((await state("hall")).zone.show_name).toBe(false);
    const { id: first } = await pairDevice(h, "alpha.test", "Hall left");
    await assign(first, { zone_key: "hall" });
    expect((await state("hall")).zone.show_name).toBe(false);
    const before = await state("bar");
    // A mirror is a screen too: the second one names every zone, also one it does not show.
    const { id: second } = await pairDevice(h, "alpha.test", "Hall right");
    await assign(second, { mirror_of: { device_id: first } });
    expect((await state("hall")).zone).toMatchObject({ key: "hall", show_name: true });
    const after = await state("bar");
    expect(after.zone.show_name).toBe(true);
    expect(after.state_version).toBe(before.state_version + 1);
    // A paired device without a zone shows nothing, so it is no screen.
    await call(h, "DELETE", `/api/screen/devices/${second}/assignment`, { session: "admin" });
    expect((await state("bar")).zone.show_name).toBe(false);
  });

  it("follows `always` and `never` whatever the count, and keeps `auto` as the default", async () => {
    const saved = await setName("bar", "always");
    expect(saved.json()).toMatchObject({ screen_name: "always" });
    expect((await state("bar")).zone.show_name).toBe(true);
    await setName("bar", "never");
    expect((await state("bar")).zone.show_name).toBe(false);
    const read = await call(h, "GET", "/api/screen/zones/hall", { session: "admin" });
    expect(read.json()).toMatchObject({ screen_name: "auto" });
  });

  it("refuses a value the contract does not list", async () => {
    for (const screenName of ["sometimes", null, true]) {
      const res = await call(h, "POST", "/api/screen/zones", {
        session: "admin",
        body: { key: "odd", name: "Odd", screen_name: screenName },
      });
      expect([res.statusCode, code(res)]).toEqual([400, "invalid_request"]);
    }
  });

  it("previews the setting without saving it", async () => {
    const zone = (await call(h, "GET", "/api/screen/zones/hall", { session: "admin" })).json<{
      revision: number;
    }>();
    const res = await call(h, "POST", "/api/screen/zones/hall/preview", {
      session: "admin",
      body: { ...zone, screen_name: "always" },
    });
    expect(res.json<Zone>().zone.show_name).toBe(true);
    expect((await state("hall")).zone.show_name).toBe(false);
  });
});
