// The draft on a screen and the current tokens for pages (contracts/theming.md, Draft, preview,
// publish: On a screen; Reading the current theme: The current tokens, for pages; #432, #444).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTenant } from "@canccu/kit";
import {
  DATABASE_URL,
  OUTSIDE_IP,
  caller,
  code,
  get,
  harness,
  seedRevision,
  send,
} from "./helpers.js";
import type { Harness } from "./helpers.js";

describe.skipIf(!DATABASE_URL)("a preview key to the draft", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    for (const tenant of ["alpha", "beta"]) {
      await withTenant(tenant, () =>
        h.db.tenant(async (c) => {
          for (const table of ["theming_drafts", "theming_revisions", "theming_preview_keys"]) {
            await c.query(`DELETE FROM ${table}`);
          }
        }),
      );
    }
  });

  const internal = (key: string, tenant = "alpha", module = "screen") =>
    h.app.inject({
      method: "GET",
      url: `/internal/theming/previews/${key}?tenant_id=${tenant}`,
      headers: { host: "theming:8080", ...caller(module) },
    });

  async function draftWithKey(): Promise<{ key: string; version: number }> {
    const draft = await send(h, "POST", "/api/theming/draft", { from: "defaults" });
    const version = draft.json<{ draft_version: number }>().draft_version;
    const edited = await send(h, "PATCH", "/api/theming/draft/tokens", {
      draft_version: version,
      tokens: { colors: { primary: "#ff9a3c" } },
    });
    expect(edited.statusCode).toBe(200);
    const res = await send(h, "POST", "/api/theming/draft/preview-key");
    expect(res.statusCode).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json<{ preview_key: string; expires_at: string }>();
    expect(body.preview_key).toMatch(/^[A-Za-z0-9_-]{32,64}$/);
    const hours = (Date.parse(body.expires_at) - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);
    return { key: body.preview_key, version: version + 1 };
  }

  it("is made only for an existing draft, by whoever may write the theme", async () => {
    expect(code(await send(h, "POST", "/api/theming/draft/preview-key"))).toBe("no_draft");
    await send(h, "POST", "/api/theming/draft", { from: "defaults" });
    const member = await send(h, "POST", "/api/theming/draft/preview-key", undefined, {
      session: "member",
    });
    expect(member.statusCode).toBe(403);
  });

  it("lets Screen read the draft, with its addresses under the key, and no one else", async () => {
    const { key, version } = await draftWithKey();
    const res = await internal(key);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const theme = res.json<Record<string, unknown>>();
    expect(theme).toMatchObject({
      revision: null,
      tokens: { colors: { primary: "#ff9a3c" } },
      tokens_css_url: `/theming/preview/${key}/tokens.css?v=${version}`,
      layouts: [],
      templates: [],
    });
    expect((await internal(key, "alpha", "agenda")).statusCode).toBe(403);
    // Another event's key, or the right key named for another event, finds nothing.
    expect((await internal(key, "beta")).statusCode).toBe(404);
    expect((await internal("x".repeat(43))).statusCode).toBe(404);
  });

  it("serves the draft's tokens to whoever holds the key, without a session, never cached", async () => {
    const { key } = await draftWithKey();
    const res = await get(h, `/theming/preview/${key}/tokens.css`, { ip: OUTSIDE_IP });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/css/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain("#ff9a3c");
    expect((await get(h, `/theming/preview/${key}/theme.css`)).statusCode).toBe(200);
    expect((await get(h, `/theming/preview/${"y".repeat(43)}/tokens.css`)).statusCode).toBe(404);
    expect(
      (await get(h, `/theming/preview/${key}/tokens.css`, { host: "beta.test" })).statusCode,
    ).toBe(404);
    expect((await get(h, `/theming/preview/${key}/other.css`)).statusCode).toBe(404);
  });

  it("dies with the draft: discard and publish both end it", async () => {
    const first = await draftWithKey();
    await send(h, "DELETE", `/api/theming/draft?draft_version=${first.version}`);
    expect((await internal(first.key)).statusCode).toBe(404);
    expect((await get(h, `/theming/preview/${first.key}/tokens.css`)).statusCode).toBe(404);
    const second = await draftWithKey();
    const published = await send(h, "POST", "/api/theming/draft/publish", {
      draft_version: second.version,
    });
    expect(published.statusCode).toBe(201);
    expect((await internal(second.key)).statusCode).toBe(404);
  });

  it("dies after 12 hours; a new key leaves the older ones alive", async () => {
    const { key } = await draftWithKey();
    const again = await send(h, "POST", "/api/theming/draft/preview-key");
    const newer = again.json<{ preview_key: string }>().preview_key;
    expect((await internal(key)).statusCode).toBe(200);
    expect((await internal(newer)).statusCode).toBe(200);
    // As the owner: the app role may not move a key's end (it only adds and removes keys).
    await h.pool.query(`UPDATE theming_preview_keys SET expires_at = now() - interval '1 second'`);
    expect((await internal(key)).statusCode).toBe(404);
  });
});

describe.skipIf(!DATABASE_URL)("the current tokens for pages", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });

  it("serves the current token CSS at a stable address, public in every info-page mode", async () => {
    for (const host of ["alpha.test", "venue.test", "closed.test"]) {
      for (const file of ["tokens.css", "admin-tokens.css"]) {
        const res = await get(h, `/theming/current/${file}`, { host, ip: OUTSIDE_IP });
        expect(res.statusCode, `${host} ${file}`).toBe(200);
        expect(res.headers["content-type"]).toMatch(/^text\/css/);
        expect(res.headers["cache-control"]).toBe("no-cache");
        expect(res.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
        expect(res.body).toContain(":root");
      }
    }
    // The venue's profile sets its own primary: revision 0 carries it.
    const venue = await get(h, "/theming/current/tokens.css", { host: "venue.test" });
    expect(venue.body).toContain("#14b8a6");
  });

  it("builds revision zero only while it is the current one (#485)", async () => {
    await seedRevision(h, "zeta", 1, { colors: { primary: "#3ddcff" } });
    h.profileReads.length = 0;
    const published = await get(h, "/theming/current/tokens.css", { host: "zeta.test" });
    expect(published.body).toContain("#3ddcff");
    expect(h.profileReads).toEqual([]);
    const zero = await get(h, "/theming/current/admin-tokens.css", { host: "venue.test" });
    expect(zero.body).toContain(":root");
    expect(h.profileReads).toEqual(["venue"]);
  });

  it("answers 304 to the ETag it gave, and 404 for any other name", async () => {
    const first = await get(h, "/theming/current/tokens.css");
    const etag = first.headers.etag as string;
    const again = await get(h, "/theming/current/tokens.css", {}, { "if-none-match": etag });
    expect(again.statusCode).toBe(304);
    expect((await get(h, "/theming/current/theme.css")).statusCode).toBe(404);
  });

  it("follows a publish at the next load", async () => {
    const before = (await get(h, "/theming/current/tokens.css", { host: "beta.test" })).headers
      .etag;
    const draft = await send(
      h,
      "POST",
      "/api/theming/draft",
      { from: "defaults" },
      { host: "beta.test" },
    );
    const version = draft.json<{ draft_version: number }>().draft_version;
    await send(
      h,
      "PATCH",
      "/api/theming/draft/tokens",
      { draft_version: version, tokens: { colors: { primary: "#3ddcff" } } },
      { host: "beta.test" },
    );
    const published = await send(
      h,
      "POST",
      "/api/theming/draft/publish",
      { draft_version: version + 1 },
      { host: "beta.test" },
    );
    expect(published.statusCode).toBe(201);
    const after = await get(h, "/theming/current/tokens.css", { host: "beta.test" });
    expect(after.headers.etag).not.toBe(before);
    expect(after.body).toContain("#3ddcff");
  });
});
