/** Studio → Moments: On air, Spotlight, Priorities and History, drawn and used as a browser does. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DEFAULT_ORDER } from "../src/arbiter.js";
import { applyClaims } from "../src/placements.js";
import { addZone } from "../src/store.js";
import { DATABASE_URL, claims, freshDatabase } from "./helpers.js";
import { appWorld, idOf } from "./app.js";
import type { AppWorld } from "./app.js";

const run = DATABASE_URL ? describe : describe.skip;
const form = { form: true };

run("the Moments pages", () => {
  let pool: pg.Pool | undefined;
  let w: AppWorld;
  beforeEach(async () => {
    // The world of the test before, if any: both are set together.
    if (pool !== undefined) {
      await w.app.close();
      await pool.end();
    }
    pool = await freshDatabase();
    w = await appWorld(pool);
  });
  afterAll(async () => {
    await w.app.close();
    await pool?.end();
  });

  it("sends a signed-out browser to sign in and back, and opens On air while live, Priorities before", async () => {
    const out = await w.call(null, "GET", "/on-air?zone=main");
    expect(out.statusCode).toBe(303);
    expect(out.headers.location).toBe("/admin/sign-in?next=%2Fmoments%2Fon-air%3Fzone%3Dmain");
    expect((await w.call("reader", "GET", "/")).headers.location).toBe("/moments/on-air");
    expect(
      (await w.call("reader", "GET", "/", undefined, { host: "draft.test" })).headers.location,
    ).toBe("/moments/priorities");
    expect((await w.call("nobody", "GET", "/on-air")).headers.location).toBe("/admin/sign-in");
  });

  it("draws On air per zone with what is placed, what waits and why, and the crew's actions", async () => {
    const top = await w.call("crew", "POST", "/api/moments/spotlight", {
      show: "message",
      title: "Pizza is here",
    });
    const low = await w.call("crew", "POST", "/api/moments/spotlight", {
      show: "message",
      title: "Waiting one",
    });
    await w.tx("demo", async (c) => {
      await addZone(c, "main");
      await applyClaims(c, claims("main", [[idOf(top), "hero"]], [idOf(low)]), w.now);
    });
    const page = await w.call("crew", "GET", "/on-air");
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-security-policy"]).toContain("frame-src 'self'");
    expect(page.body).toContain("Pizza is here");
    expect(page.body).toContain("Queued");
    expect(page.body).toContain("no region of its chain is free");
    expect(page.body).toContain("End in zone");
    expect(page.body).toContain("Spotlight…");
    expect(page.body).not.toContain("Press and hold 2 s");
    const admin = await w.call("admin", "GET", "/on-air");
    expect(admin.body).toContain("Press and hold 2 s");
    const reader = await w.call("reader", "GET", "/on-air");
    expect(reader.body).not.toContain("End in zone");
  });

  it("starts a spotlight from the form on the zones ticked, and says so", async () => {
    await w.tx("demo", (c) =>
      c.query(`INSERT INTO moments_zones (zone_key) VALUES ('main'), ('stage')`),
    );
    const formPage = await w.call("crew", "GET", "/spotlight");
    expect(formPage.body).toContain('name="idempotency_key"');
    const body = new URLSearchParams({
      idempotency_key: "form-key-0001",
      show: "message",
      title: "Doors open",
      duration_seconds: "600",
    });
    body.append("zone", "main");
    body.append("zone", "stage");
    const r = await w.app.inject({
      method: "POST",
      url: "/spotlight",
      headers: {
        host: "demo.test",
        cookie: "canccu_session=crew",
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: body.toString(),
    });
    expect(r.statusCode).toBe(303);
    expect(r.headers.location).toBe("/moments/on-air?done=Spotlight%20on%20air.");
    const [e] = w.events("demo");
    expect(e?.data.override).toMatchObject({
      zones: ["main", "stage"],
      content: { title: "Doors open", from_crew: true },
    });
    expect(e?.data.override).toMatchObject({
      expires_at: new Date(w.now.getTime() + 600_000).toISOString(),
    });
  });

  it("asks once more for an emergency sent without the hold, and starts it after", async () => {
    const ask = await w.call(
      "admin",
      "POST",
      "/emergency",
      { idempotency_key: "emergency-001" },
      form,
    );
    expect(ask.statusCode).toBe(200);
    expect(ask.body).toContain("Start the emergency");
    expect(w.events("demo")).toHaveLength(0);
    const go = await w.call(
      "admin",
      "POST",
      "/emergency",
      { idempotency_key: "emergency-001", held: "yes" },
      form,
    );
    expect(go.statusCode).toBe(303);
    expect(w.events("demo")[0]?.data.override).toMatchObject({ rank: 100 });
    const page = await w.call("admin", "GET", "/on-air");
    expect(page.body).toContain("End emergency");
  });

  it("previews a split moment by the override its zone holds", async () => {
    await w.tx("demo", (c) => c.query(`INSERT INTO moments_zones (zone_key) VALUES ('main')`));
    const own = [
      "emergency",
      "spotlight",
      "stream",
      "announcement",
      "storyboard",
      "tournament",
      "finals",
      "hot_game",
      "reactions",
      "ticker",
    ];
    await w.call("admin", "PUT", "/api/moments/priorities", {
      order: [...DEFAULT_ORDER],
      zones: [{ zone_key: "main", order: own }],
      revision: 0,
    });
    const spot = await w.call("crew", "POST", "/api/moments/spotlight", {
      show: "message",
      title: "Split",
    });
    // The draft gives main the event's order back: the zone still holds `<id>.main`.
    const page = await w.call(
      "admin",
      "GET",
      `/priorities?scope=main&order=${DEFAULT_ORDER.join(",")}`,
    );
    expect(page.body).toContain(`${idOf(spot)}.main&quot;:70`);
  });

  it("moves a class in a draft order, previews it with its ranks, and saves it live", async () => {
    await w.tx("demo", (c) => c.query(`INSERT INTO moments_zones (zone_key) VALUES ('main')`));
    const spot = await w.call("crew", "POST", "/api/moments/spotlight", {
      show: "message",
      title: "Live",
    });
    const page = await w.call(
      "admin",
      "GET",
      "/priorities?scope=&order=emergency,spotlight,stream,announcement,storyboard,tournament,finals,hot_game,reactions,ticker",
    );
    expect(page.body).toContain("Not saved yet");
    expect(page.body).toContain('src="/screen/zones/main"');
    expect(page.body).toContain(`${idOf(spot)}&quot;:90`);
    const save = await w.call(
      "admin",
      "POST",
      "/priorities",
      {
        scope: "",
        order:
          "emergency,spotlight,stream,announcement,storyboard,tournament,finals,hot_game,reactions,ticker",
        revision: "0",
        do: "save",
      },
      form,
    );
    expect(save.statusCode).toBe(303);
    expect(save.headers.location).toContain("done=");
    expect(w.events("demo").at(-1)?.data).toMatchObject({ changed: ["rank"] });
    const zone = await w.call(
      "admin",
      "POST",
      "/priorities",
      {
        scope: "main",
        order:
          "emergency,stream,announcement,spotlight,storyboard,tournament,finals,hot_game,reactions,ticker",
        revision: "1",
        do: "save",
      },
      form,
    );
    expect(zone.headers.location).toContain("done=");
    const rules = await w.call("reader", "GET", "/priorities");
    expect(rules.body).toContain("Built-in rules");
    expect(rules.body).not.toContain("Save order");
  });

  it("lists the history with its filters and the CSV export", async () => {
    await w.call("crew", "POST", "/api/moments/spotlight", {
      show: "message",
      title: "In the history",
    });
    const page = await w.call("reader", "GET", "/history?origin=crew");
    expect(page.body).toContain("In the history");
    expect(page.body).toContain('href="/api/moments/history.csv?origin=crew"');
    expect((await w.call("reader", "GET", "/history?origin=x")).statusCode).toBe(400);
  });

  it("draws only the collection and board pages wide (amendment 3); the rest keep 64rem", async () => {
    const wide = async (path: string) => {
      const page = await w.call("admin", "GET", path);
      expect(page.statusCode, path).toBe(200);
      return page.body.includes("canccu-main--wide");
    };
    for (const path of ["/on-air", "/storyboards", "/cues/library"]) {
      expect(await wide(path), path).toBe(true);
    }
    for (const path of [
      "/priorities",
      "/history",
      "/scenes",
      "/cues",
      "/cues/limits",
      "/cues/log",
      "/spotlight",
      "/announce",
    ]) {
      expect(await wide(path), path).toBe(false);
    }
  });

  it("serves the pages' own static files", async () => {
    for (const name of ["ui.css", "moments.css", "organiser.css", "moments.js"]) {
      expect((await w.call("reader", "GET", `/static/${name}`)).statusCode).toBe(200);
    }
    expect((await w.call("reader", "GET", "/static/other.js")).statusCode).toBe(404);
  });
});
