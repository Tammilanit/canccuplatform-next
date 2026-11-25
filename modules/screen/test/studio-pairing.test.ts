/**
 * The guided pairing in Screen studio (#783): the newly paired screen appears live on Devices,
 * waiting, then on, with a test pattern and Identify, or says plainly when it has not connected;
 * the pair dialog's error area, the plain-http notice and the venue check's hint.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, call, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

describe.skipIf(!DATABASE_URL)("studio pairing", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });

  const page = (url: string, host = "alpha.test", session: string | null = "admin") =>
    call(h, "GET", url, { host, ...(session === null ? {} : { session }) });
  /** The "just paired" panel of the page, or "" without one. */
  const panel = (body: string): string => {
    const at = body.indexOf('data-live="paired-');
    return at < 0 ? "" : body.slice(at, body.indexOf("</section>", at));
  };

  it("shows the new screen waiting to connect, updating fast, with Test pattern and Identify", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Hall left");
    const body = (await page(`/admin/screen/devices?paired=${id}`)).body;
    const part = panel(body);
    expect(part).toContain("Waiting for Hall left to connect…");
    expect(part).toContain("data-live-fast");
    expect(part).toContain(`/api/screen/devices/${id}/commands`);
    expect(part).toContain(JSON.stringify({ command: "test_pattern" }).replaceAll('"', "&quot;"));
    expect(part).toContain(">Test pattern<");
    expect(part).toContain(">Identify<");
  });

  it("says the screen is on once it is seen, and stops updating fast", async () => {
    const { id, token } = await pairDevice(h, "alpha.test", "Bar TV");
    await call(h, "POST", "/api/screen/device/heartbeat", {
      host: "alpha.test",
      cookies: { canccu_device: token },
      body: { state_version: 0, bundle_version: "b1", theme_revision: 0, viewport: { width: 1920, height: 1080 } },
    }); // prettier-ignore
    const part = panel((await page(`/admin/screen/devices?paired=${id}`)).body);
    expect(part).toContain("Bar TV is on.");
    expect(part).toContain("Test pattern");
    expect(part).not.toContain("data-live-fast");
  });

  it("says in plain words what to do when the screen has not connected after a minute", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Stage left");
    // Paired 61 s ago on the harness's clock (the row's own time is the database's).
    await h.pool.query("UPDATE screen_assignments SET paired_at = $2 WHERE device_id = $1", [
      id,
      new Date(h.clock.now - 61_000),
    ]);
    const body = (await page(`/admin/screen/devices?paired=${id}`)).body;
    const part = panel(body);
    expect(part).toContain("Stage left has not connected");
    expect(part).toContain("still shows its code");
    // The device's own card says it too, in its help.
    const card = body.slice(body.indexOf(`id="device-${id}"`));
    expect(card).toContain("has not connected since it was paired");
  });

  it("shows no panel for a screen that is not this event's", async () => {
    const body = (await page("/admin/screen/devices?paired=dv_nope")).body;
    expect(panel(body)).toBe("");
  });

  it("offers a test pattern on every screen's card, beside Identify and Reload", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Lobby");
    const body = (await page("/admin/screen/devices")).body;
    const card = body.slice(body.indexOf(`id="device-${id}"`));
    expect(card).toContain(">Test pattern<");
  });

  it("gives the pair dialog an error area and a plain-http notice, shown by the page script", async () => {
    const body = (await page("/admin/screen/devices")).body;
    const dialog = body.slice(body.indexOf('id="canccu-studio-pair"'));
    expect(dialog).toMatch(/<p[^>]*data-pair-error[^>]*role="alert"[^>]*hidden/);
    expect(body).toContain("This address can&#39;t pair screens: open it with https.");
    expect(body).toMatch(/data-insecure[^>]*hidden/);
    expect(body).toContain('src="/admin/screen/static/studio-devices.js"');
    // The words the script shows come in the page's own language.
    expect(body).toContain('"pair.error.code":');
    expect(body).toContain('"pair.error.offline":');
  });

  it("says in the dialog when the event lets screens play only on the venue's network", async () => {
    const restricted = (await page("/admin/screen/devices")).body;
    expect(restricted).toContain("only on the venue&#39;s network");
    const open = (await page("/admin/screen/devices", "open.test")).body;
    expect(open).not.toContain("only on the venue&#39;s network");
  });

  it("keeps a signed-out scan from going to sign-in over plain http, and says why", async () => {
    const body = (await page("/admin/screen/devices", "alpha.test", null)).body;
    expect(body).toMatch(/data-insecure[^>]*hidden/);
    expect(body).toContain("open it with https");
  });

  it("carries the organiser's Set up a screen guide: kiosk mode, autostart, sound, portrait", async () => {
    const body = (await page("/admin/screen/devices")).body;
    const guide = body.slice(body.indexOf("data-setup-guide"));
    expect(guide).toContain("Set up a screen");
    expect(guide).toContain("https://alpha.test/screen/");
    expect(guide).toContain("--kiosk");
    expect(guide).toContain("--autoplay-policy=no-user-gesture-required");
    expect(guide).toMatch(/autostart|starts by itself/i);
    expect(guide).toMatch(/portrait/i);
  });
});
