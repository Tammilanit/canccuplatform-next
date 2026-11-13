/**
 * `GET /theming/logo` (contracts/theming.md, Reading the current theme; #439): the one address
 * the organiser shell and the posters name for the event's logo, or its initials without one.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TenantResolver, withTenant } from "@canccu/kit";
import { DATABASE_URL, get, harness, seedRevision } from "./helpers.js";
import type { Harness } from "./helpers.js";

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="1"/>');
const EVENT = { name: "Demo Event", status: "live" } as const;

describe.skipIf(!DATABASE_URL)("the current logo", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is the event's initials in its colours while the theme has no logo", async () => {
    vi.spyOn(TenantResolver.prototype, "event").mockResolvedValue(EVENT as never);
    const res = await get(h, "/theming/logo", { host: "beta.test" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/svg+xml");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(res.body).toContain(">DE</text>");
    expect(res.body).toContain('stop-color="#3b82f6"');
    // Unchanged, it is not sent again.
    const etag = String(res.headers.etag);
    const again = await get(h, "/theming/logo", { host: "beta.test" }, { "if-none-match": etag });
    expect(again.statusCode).toBe(304);
  });

  it("names no one when the tenants module does not answer", async () => {
    vi.spyOn(TenantResolver.prototype, "event").mockResolvedValue(null);
    const res = await get(h, "/theming/logo", { host: "beta.test" });
    expect(res.body).toContain(">?</text>");
  });

  it("sends the browser to the current logo's revision file", async () => {
    await seedRevision(h, "alpha", 1);
    const name = await withTenant("alpha", () =>
      h.db.tenant(async (c) => {
        const file = await h.files.put(c, SVG, "svg");
        await c.query("UPDATE theming_revisions SET logo = $1 WHERE revision = 1", [file]);
        await c.query("INSERT INTO theming_file_refs (owner, file) VALUES ('r:1', $1)", [file]);
        return file;
      }),
    );
    const res = await get(h, "/theming/logo", { host: "alpha.test" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`/theming/a/${name}`);
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("is 404 on a hostname that is no event", async () => {
    expect((await get(h, "/theming/logo", { host: "nope.test" })).statusCode).toBe(404);
  });
});
