/**
 * The test app itself (#698): it answers every other module from its fakes, never from the
 * network. A real lookup of `tenants` cost a test the resolver's 5 s retry on CI, at random.
 */
import dns from "node:dns";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DATABASE_URL, freshDatabase } from "./helpers.js";
import { appWorld } from "./app.js";

describe.skipIf(!DATABASE_URL)("the test app", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = await freshDatabase();
  });
  afterAll(async () => {
    await pool.end();
  });

  it("names the event from its fake tenants and looks up no host", async () => {
    const lookup = vi.spyOn(dns, "lookup");
    try {
      const w = await appWorld(pool);
      const page = await w.call("admin", "GET", "/storyboards");
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain("Demo Event");
      expect(lookup.mock.calls.map(([host]) => host)).not.toContain("tenants");
    } finally {
      lookup.mockRestore();
    }
  });
});
