/**
 * The Screen studio's Content page (#263; mockup 10): the library with search and kinds, upload,
 * the storage use, replace and one-step revert, web and YouTube only while `screen.web` is on, a
 * deck's render job slide by slide, and the rights shown and checked per action.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DATABASE_URL, SESSIONS, call, harness, png, upload } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { fakeRenderer, pdfPages } from "./render-fake.js";
import type { FakeRenderer } from "./render-fake.js";

interface Asset {
  id: string;
  version: number;
  can_revert: boolean;
}

describe.skipIf(!DATABASE_URL)("studio content", () => {
  let h: Harness;
  let dir: string;
  let renderer: FakeRenderer;
  beforeAll(async () => {
    SESSIONS.decks = ["screen.content.read"];
    h = await harness();
    dir = await mkdtemp(join(tmpdir(), "canccu-studio-content-"));
  });
  afterAll(async () => {
    Reflect.deleteProperty(SESSIONS, "decks");
    await h.close();
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    renderer = await fakeRenderer(dir, { slides: 2 });
  });
  afterEach(async () => {
    await h.pool.query(
      "UPDATE screen_render_jobs SET state = 'cancelled' WHERE state IN ('queued', 'running')",
    );
    for (let j; (j = await h.queue.take(1, h.clock.now));) await h.queue.release(j.tenant, j.jobId);
    await renderer.close();
  });

  const page = (url: string, session?: string, host = "alpha.test") =>
    call(h, "GET", url, { host, ...(session ? { session } : {}) });
  const content = (session = "editor", query = "", host = "alpha.test") =>
    page(`/admin/screen/content${query}`, session, host);
  /** The card of one asset in the page, up to the next card. */
  const card = (body: string, id: string): string => {
    const from = body.indexOf(`id="asset-${id}"`);
    expect(from).toBeGreaterThan(-1);
    const next = body.indexOf('id="asset-', from + 1);
    return body.slice(from, next === -1 ? undefined : next);
  };
  let seed = 100;
  const addImage = async (name: string, host = "alpha.test"): Promise<Asset> => {
    const res = await upload(h, "/api/screen/assets", await png(seed++), name, {
      host,
      session: "editor",
    });
    expect(res.statusCode).toBe(201);
    return res.json<Asset>();
  };
  const addDeck = async (name = "Keynote.pdf"): Promise<Asset> => {
    const res = await upload(h, "/api/screen/assets", pdfPages(seed++), name, {
      session: "editor",
    });
    expect(res.statusCode).toBe(201);
    return res.json<Asset>();
  };
  const jobOf = async (assetId: string) =>
    (await call(h, "GET", `/api/screen/render-jobs?asset_id=${assetId}`, { session: "editor" }))
      .json<{ jobs: { id: string; state: string }[] }>()
      .jobs.at(0);

  it("sends a signed-out browser to sign in and refuses the page without screen.content.read", async () => {
    const out = await content("");
    expect(out.statusCode).toBe(303);
    expect(out.headers.location).toBe("/admin/sign-in?next=%2Fadmin%2Fscreen%2Fcontent");
    const crew = await content("crew");
    expect(crew.statusCode).toBe(403);
    expect(crew.body).toContain("the Screen studio");
    expect(crew.body).not.toContain("screen.content.read");
  });

  it("shows the Content tab only to holders of screen.content.read, and opens on it for them", async () => {
    const tabs = (body: string) =>
      [...body.matchAll(/<nav class="canccu-tabs"[^>]*>(.*?)<\/nav>/g)][0]?.[1] ?? "";
    expect(tabs((await page("/admin/screen/live", "admin")).body)).toContain(">Content<");
    expect(tabs((await page("/admin/screen/live", "crew")).body)).not.toContain(">Content<");
    expect((await page("/admin/screen/", "decks")).headers.location).toBe("/admin/screen/content");
  });

  it("offers upload, links, replace and delete only to holders of screen.content.write", async () => {
    const poster = await addImage("poster.png");
    const editor = (await content("editor")).body;
    expect(editor).toContain("data-upload");
    expect(editor).toContain("data-add-link");
    const mine = card(editor, poster.id);
    expect(mine).toContain("poster.png");
    expect(mine).toContain(`data-replace="${poster.id}"`);
    expect(mine).toContain(`data-call="DELETE" data-url="/api/screen/assets/${poster.id}"`);
    // An image is shown as itself.
    expect(mine).toMatch(/<img[^>]+src="\/api\/screen\/files\/[0-9a-f]{64}\.png"/);
    const reader = await content("decks");
    expect(reader.statusCode).toBe(200);
    expect(reader.body).toContain("poster.png");
    expect(reader.body).not.toContain("data-upload");
    expect(reader.body).not.toContain("data-add-link");
    expect(reader.body).not.toContain("data-replace");
    expect(reader.body).not.toContain("data-call=");
  });

  it("draws the storage use from the event's quota, the client strings and the page script", async () => {
    const body = (await content()).body;
    expect(body).toContain('data-storage="/api/tenants/current/storage"');
    const text = JSON.parse(
      /<script type="application\/json" id="canccu-studio-text">(.*?)<\/script>/s.exec(body)?.[1] ??
        "{}",
    ) as Record<string, string>;
    for (const key of ["storage.used", "upload.quota", "upload.too_large", "upload.refused"]) {
      expect(text[key], key).toBeTruthy();
    }
    expect(body).toContain('<script type="module" src="/admin/screen/static/studio-content.js">');
    const script = await page("/admin/screen/static/studio-content.js");
    expect(script.statusCode).toBe(200);
    expect(script.headers["content-type"]).toContain("text/javascript");
    expect((await page("/admin/screen/static/studio-replace-plan.js")).statusCode).toBe(200);
  });

  it("finds assets by title and kind, a page of 50 at a time", async () => {
    await addImage("menu-board.png");
    await addDeck("Sponsors.pdf");
    const byTitle = (await content("editor", "?q=menu-board")).body;
    expect(byTitle).toContain("menu-board.png");
    expect(byTitle).not.toContain("Sponsors.pdf");
    expect(byTitle).toContain('value="menu-board"');
    const byKind = (await content("editor", "?kind=pdf")).body;
    expect(byKind).toContain("Sponsors.pdf");
    expect(byKind).not.toContain("menu-board.png");
    await h.pool.query(
      `INSERT INTO screen_assets (tenant_id, id, kind, title, url, created_at)
       SELECT 'beta', 'as_many' || n, 'web', 'Board ' || n, 'https://status.example/' || n,
              now() - n * interval '1 minute'
       FROM generate_series(1, 51) AS n`,
    );
    const first = (await content("editor", "", "beta.test")).body;
    expect(first).toContain(">Board 50<");
    expect(first).not.toContain(">Board 51<");
    const next = /href="(\/admin\/screen\/content\?after=[^"]+)"/.exec(first)?.[1] ?? "";
    expect(next).not.toBe("");
    const second = (await page(next.replace(/&amp;/g, "&"), "editor", "beta.test")).body;
    expect(second).toContain(">Board 51<");
    expect(second).not.toContain(">Board 50<");
  });

  it("offers one-step revert after a replace, and audits replace and revert", async () => {
    const menu = await addImage("menu.png");
    const replaced = await upload(
      h,
      `/api/screen/assets/${menu.id}/replace`,
      await png(seed++),
      "menu-v2.png",
      { session: "editor" },
    );
    expect(replaced.statusCode).toBe(200);
    const revert = `data-call="POST" data-url="/api/screen/assets/${menu.id}/revert"`;
    expect(card((await content()).body, menu.id)).toContain(revert);
    expect(card((await content("decks")).body, menu.id)).not.toContain("/revert");
    const back = await call(h, "POST", `/api/screen/assets/${menu.id}/revert`, {
      session: "editor",
    });
    expect(back.statusCode).toBe(200);
    expect(card((await content()).body, menu.id)).not.toContain(revert);
    const actions = h.audits
      .filter((a) => (a.target as { id?: string } | undefined)?.id === menu.id)
      .map((a) => a.action);
    expect(actions).toEqual([
      "screen.asset.added",
      "screen.asset.replaced",
      "screen.asset.reverted",
    ]);
  });

  it("refuses every content write without screen.content.write, and audits none of them", async () => {
    const target = await addImage("refused.png");
    const deck = await addDeck("Refused.pdf");
    const job = await jobOf(deck.id);
    const before = h.audits.length;
    const as = { session: "decks" };
    const refused = [
      await upload(h, "/api/screen/assets", await png(seed++), "x.png", as),
      await call(h, "POST", "/api/screen/assets", {
        ...as,
        body: { kind: "youtube", url: "https://youtu.be/dQw4w9WgXcQ", title: "x" },
      }),
      await call(h, "POST", "/api/screen/assets/name-check", { ...as, body: { names: ["x"] } }),
      await upload(h, `/api/screen/assets/${target.id}/replace`, await png(seed++), "y.png", as),
      await call(h, "POST", `/api/screen/assets/${target.id}/revert`, as),
      await call(h, "PATCH", `/api/screen/assets/${target.id}`, { ...as, body: { title: "z" } }),
      await call(h, "DELETE", `/api/screen/assets/${target.id}`, as),
      await call(h, "POST", "/api/screen/render-jobs", { ...as, body: { asset_id: deck.id } }),
      await call(h, "DELETE", `/api/screen/render-jobs/${job?.id}`, as),
    ];
    expect(refused.map((r) => r.statusCode)).toEqual(refused.map(() => 403));
    expect(h.audits.length).toBe(before);
    // Reads stay open to the reader, as the page shows them.
    expect((await call(h, "GET", "/api/screen/assets", as)).statusCode).toBe(200);
    expect((await call(h, "GET", `/api/screen/render-jobs/${job?.id}`, as)).statusCode).toBe(200);
  });

  it("offers web and YouTube links only while screen.web is on, and says so on such assets", async () => {
    await h.pool.query(
      `INSERT INTO screen_assets (tenant_id, id, kind, title, url)
       VALUES ('iota', 'as_iota_web', 'web', 'Status board', 'https://status.example/')`,
    );
    const off = (await content("editor", "", "iota.test")).body;
    expect(off).toContain("data-upload");
    expect(off).not.toContain("data-add-link");
    expect(card(off, "as_iota_web")).toContain("Web and YouTube are off for this event");
    const on = (await content("editor")).body;
    expect(on).toContain("data-add-link");
  });

  it("shows a deck waiting with its place in the queue, and a cancel for writers only", async () => {
    const deck = await addDeck("Welcome.pdf");
    const job = await jobOf(deck.id);
    const mine = card((await content()).body, deck.id);
    expect(mine).toContain("Waiting to render · place 1 in the queue");
    expect(mine).toContain(`data-call="DELETE" data-url="/api/screen/render-jobs/${job?.id}"`);
    expect(mine).toContain(`data-live="render-${deck.id}"`);
    expect(card((await content("decks")).body, deck.id)).not.toContain("/api/screen/render-jobs/");
  });

  it("counts each slide as it lands while the deck renders, and a cancel stops it", async () => {
    renderer.behaviour = { slides: 3, hang: true };
    const deck = await addDeck("Long.pdf");
    const job = await jobOf(deck.id);
    const running = h.dispatch(renderer.path);
    let mine = "";
    for (let i = 0; i < 100 && !mine.includes("3 slides drawn"); i++) {
      await new Promise((r) => setTimeout(r, 20));
      mine = card((await content()).body, deck.id);
    }
    expect(mine).toContain("Rendering · 3 slides drawn");
    expect(mine).toContain(`data-url="/api/screen/render-jobs/${job?.id}"`);
    expect(
      (await call(h, "DELETE", `/api/screen/render-jobs/${job?.id}`, { session: "editor" }))
        .statusCode,
    ).toBe(204);
    await running;
    const cancelled = card((await content()).body, deck.id);
    expect(cancelled).toContain("Render cancelled");
    expect(cancelled).toContain('data-call="POST" data-url="/api/screen/render-jobs"');
    expect(h.audits.map((a) => a.action)).toContain("screen.render.cancelled");
  }, 20_000);

  it("shows every slide of a rendered deck with its font warnings", async () => {
    renderer.behaviour = {
      slides: 2,
      warnings: [
        {
          code: "font_missing",
          message: "The deck uses Brand Sans.",
          font: "Brand Sans",
          slides: [2],
        },
      ],
    };
    const deck = await addDeck("Fonts.pdf");
    expect(await h.dispatch(renderer.path)).toBe(true);
    const mine = card((await content()).body, deck.id);
    expect(mine).toContain("2 slides");
    expect(mine).toContain(`src="/api/screen/renders/${deck.id}/1/slide-1.png"`);
    expect(mine).toContain(`src="/api/screen/renders/${deck.id}/1/slide-2.png"`);
    expect(mine).toContain("Brand Sans is not in the renderer: slide 2 uses a stand-in font.");
  });

  it("says why a render failed, in words, and offers to render it again", async () => {
    renderer.behaviour = {
      error: { code: "file_invalid", message: "This deck links to content outside the file." },
    };
    const deck = await addDeck("Linked.pdf");
    await h.dispatch(renderer.path);
    const mine = card((await content()).body, deck.id);
    expect(mine).toContain("Render failed");
    expect(mine).toContain("This deck links to content outside the file.");
    expect(mine).toContain('data-call="POST" data-url="/api/screen/render-jobs"');
    expect(mine).toContain(`{&quot;asset_id&quot;:&quot;${deck.id}&quot;}`);
  });
});
