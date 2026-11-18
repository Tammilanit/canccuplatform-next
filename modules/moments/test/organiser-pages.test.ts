/**
 * The organiser pages fixed after the step 4 checkpoint (#624), as a browser uses them: Priorities
 * reordered by drag and drop without rank numbers (mockup 08), the built-in rules with chips and a
 * slider, History that turns into cards on a phone (mockup 09), and the crew spotlight's photo
 * picker and hub QR switch (mockup 04).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DATABASE_URL, freshDatabase } from "./helpers.js";
import { appWorld, json } from "./app.js";
import type { AppWorld } from "./app.js";

/** A form post with repeated fields, as a browser sends ticked boxes. */
function post(w: AppWorld, who: string, url: string, fields: [string, string][]) {
  return w.app.inject({
    method: "POST",
    url,
    headers: {
      host: "demo.test",
      cookie: `canccu_session=${who}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    payload: new URLSearchParams(fields).toString(),
  });
}

describe.skipIf(!DATABASE_URL)("the organiser pages", () => {
  let pool: pg.Pool | undefined;
  let w: AppWorld;
  beforeEach(async () => {
    if (pool !== undefined) {
      await w.app.close();
      await pool.end();
    }
    pool = await freshDatabase();
    w = await appWorld(pool);
    await w.tx("demo", (c) =>
      c.query(`INSERT INTO moments_zones (zone_key) VALUES ('main'), ('stage')`),
    );
  });
  afterAll(async () => {
    await w.app.close();
    await pool?.end();
  });

  it("orders the classes by their handles, without rank numbers, Emergency locked at the top", async () => {
    const page = (await w.call("admin", "GET", "/priorities")).body;
    const order = page.slice(page.indexOf("data-order>"), page.indexOf("</ol>"));
    expect(order).toContain("locked at the top");
    expect(order).not.toMatch(/canccu-num|>100<|>90</);
    // Every class but the emergency has a handle, for a pointer, a finger or the arrow keys.
    expect(order.match(/data-order-handle/g)).toHaveLength(9);
    expect(order.indexOf("Emergency")).toBeLessThan(order.indexOf("data-order-handle"));
    expect(page).toContain('aria-describedby="order-help"');
    expect(page).toContain("or focus it and use the arrow keys");
    // Without the script the arrows still move a class, as a draft of the order.
    expect(order).toMatch(/<noscript\s*>/);
    expect(order).toContain("Move Announcement up");
    expect(page).toMatch(/name="order"\s+data-order-input/);
    const reader = (await w.call("reader", "GET", "/priorities")).body;
    expect(reader).not.toContain("data-order-handle");
  });

  it("draws a rule's regions and zones as chips and its seconds as a slider, and saves them", async () => {
    const page = (await w.call("admin", "GET", "/priorities")).body;
    const standings = page.slice(page.indexOf('action="/moments/rules/standings"'));
    const form = standings.slice(0, standings.indexOf("</form>"));
    expect(form).toMatch(/type="checkbox"\s+name="regions"\s+value="hero"\s+checked/);
    expect(form).toMatch(/type="checkbox"\s+name="regions"\s+value="ticker"\s*\/>/);
    expect(form).toMatch(/type="checkbox"\s+name="zones"\s+value="stage"\s*\/>/);
    expect(form).toMatch(
      /type="range"\s+name="ttl_seconds"\s+min="5"\s+max="600"\s+step="5"\s+value="120"/,
    );
    expect(form).toContain("2 min");
    // An event name breaks only after a dot, never inside a word.
    expect(form).toContain("tournament.<wbr />leaderboard.<wbr />changed");
    expect(form).toMatch(/<select class="canccu-input" name="cue"/);
    expect(form).toContain('<option value="">No cue</option>');
    const saved = await post(w, "admin", "/rules/standings", [
      ["revision", "0"],
      ["template", "leaderboard"],
      ["enabled", "true"],
      ["class", "tournament"],
      ["regions", "hero"],
      ["regions", "ticker"],
      ["ttl_seconds", "90"],
      ["zones", "stage"],
      ["cue", "tournament.start"],
    ]);
    expect(saved.headers.location).toContain("done=Rule%20saved");
    const rules = json(await w.call("admin", "GET", "/api/moments/rules")).rules as {
      rule_id: string;
    }[];
    expect(rules.find((r) => r.rule_id === "standings")).toMatchObject({
      regions: ["hero", "ticker"],
      zones: ["stage"],
      ttl_seconds: 90,
      cue: "tournament.start",
    });
  });

  it("labels each History cell, so a phone shows a row as a card", async () => {
    await w.call("crew", "POST", "/api/moments/spotlight", { show: "message", title: "Hello" });
    const page = (await w.call("reader", "GET", "/history")).body;
    expect(page).toContain('class="canccu-table moments-history"');
    // Its phone layout is in the organiser pages' own stylesheet.
    expect(page).toContain('href="/moments/static/organiser.css"');
    for (const label of ["Time", "Zone", "Region", "Why", "Displaced", "Ended or outcome"])
      expect(page).toContain(`data-label="${label}"`);
  });

  it("lets the crew pick a photo by its thumbnail and switch on the hub's QR", async () => {
    const empty = (await w.call("crew", "GET", "/spotlight")).body;
    expect(empty).toContain("No images yet");
    w.images.push(
      {
        id: "as_poster",
        title: "Poster",
        url: "/api/screen/files/abc.png",
        type: "image/png",
        body: Buffer.from("png bytes"),
      },
      {
        id: "as_team",
        title: "Team photo",
        url: "/api/screen/files/def.jpg",
        type: "image/jpeg",
        body: Buffer.from("jpeg bytes"),
      },
    );
    const page = (await w.call("crew", "GET", "/spotlight")).body;
    expect(page).toContain('type="radio" name="photo_asset" value="as_poster"');
    expect(page).toContain('src="/moments/spotlight/images/as_poster"');
    expect(page).toContain('alt="Team photo"');
    expect(page).toContain('type="checkbox" name="hub_qr" value="yes"');
    expect(page).not.toContain('name="photo_url"');
    expect(page).not.toContain('name="qr_path"');
    const thumb = await w.call("crew", "GET", "/spotlight/images/as_team");
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers["content-type"]).toBe("image/jpeg");
    expect(thumb.body).toBe("jpeg bytes");
    expect((await w.call("crew", "GET", "/spotlight/images/as_none")).statusCode).toBe(404);
    expect((await w.call("reader", "GET", "/spotlight/images/as_team")).statusCode).not.toBe(200);
    const go = await post(w, "crew", "/spotlight", [
      ["idempotency_key", "form-key-photo"],
      ["show", "photo"],
      ["photo_asset", "as_team"],
      ["hub_qr", "yes"],
      ["duration_seconds", "300"],
    ]);
    expect(go.headers.location).toBe("/moments/on-air?done=Spotlight%20on%20air.");
    const content = (w.events("demo")[0]?.data.override as { content: Record<string, unknown> })
      .content;
    expect(content).toMatchObject({ url: "/api/screen/files/def.jpg", from_crew: true });
    expect(content.qr).toMatchObject({
      url: "https://demo.test/notify/",
      label: "Scan for the hub",
    });
  });

  it("refuses a photo that is not one of the event's images", async () => {
    const go = await post(w, "crew", "/spotlight", [
      ["idempotency_key", "form-key-nophoto"],
      ["show", "photo"],
      ["photo_asset", "as_gone"],
    ]);
    expect(decodeURIComponent(String(go.headers.location))).toContain("Pick one of the photos");
    expect(w.events("demo")).toHaveLength(0);
  });
});
