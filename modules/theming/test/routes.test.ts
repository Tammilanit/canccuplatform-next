import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation } from "@canccu/kit/testing";
import { platformTokens } from "../src/tokens.js";
import { DATABASE_URL, OUTSIDE_IP, code, get, harness, seedRevision } from "./helpers.js";
import type { Harness } from "./helpers.js";

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');

describe.skipIf(!DATABASE_URL)("theming core", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });

  describe("GET /api/theming/current", () => {
    it("answers the platform defaults as revision 0 without a published theme", async () => {
      const res = await get(h, "/api/theming/current", { host: "beta.test" });
      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      expect(body).toMatchObject({
        revision: 0,
        theming_version: 1,
        tokens: platformTokens(),
        embed_color: 0x3b82f6,
        layouts: [],
        templates: [],
        embeds: [],
      });
      expect(body).not.toHaveProperty("css_url");
      const css = await get(h, body.tokens_css_url as string, { host: "beta.test" });
      expect(css.statusCode).toBe(200);
      expect(css.body).toContain("--canccu-color-primary: #3b82f6;");
    });

    it("answers the highest revision, with its files served", async () => {
      await seedRevision(h, "alpha", 1, { colors: { accent: "#fbbf24" } });
      const second = await seedRevision(
        h,
        "alpha",
        2,
        { colors: { text: "#0f172a" } },
        { css: Buffer.from(".t-x { color: red }") },
      );
      const res = await get(h, "/api/theming/current");
      const body = res.json<Record<string, unknown>>();
      expect(body).toMatchObject({
        revision: 2,
        tokens_css_url: `/theming/a/${second.tokensCss}`,
        admin_tokens_css_url: `/theming/a/${second.adminCss}`,
        css_url: `/theming/a/${second.css ?? ""}`,
        layouts: [{ id: "main" }],
      });
      expect(typeof body.published_at).toBe("string");
      // The theme fails the contrast rules, so admin pages get the platform colours.
      const admin = await get(h, body.admin_tokens_css_url as string);
      expect(admin.body).toContain("--canccu-color-text: #f8fafc;");
      const own = await get(h, body.tokens_css_url as string);
      expect(own.body).toContain("--canccu-color-text: #0f172a;");
    });

    it("applies the event profile's theme over the defaults at revision 0", async () => {
      const res = await get(h, "/api/theming/current", { host: "venue.test" });
      const body = res.json<
        { tokens: { colors: Record<string, string> } } & Record<string, unknown>
      >();
      expect(body.revision).toBe(0);
      expect(body.tokens.colors.primary).toBe("#14b8a6");
      expect(body.embed_color).toBe(0x14b8a6);
      const css = await get(h, body.tokens_css_url as string, { host: "venue.test" });
      expect(css.statusCode).toBe(200);
      expect(css.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      expect(css.body).toContain("--canccu-color-primary: #14b8a6;");
      // Generated from this event's profile, so another event never serves it.
      const elsewhere = await get(h, body.tokens_css_url as string, { host: "beta.test" });
      expect(elsewhere.statusCode).toBe(404);
    });

    it("lets a published revision win over the profile's theme", async () => {
      await seedRevision(h, "venue", 1, { colors: { accent: "#fbbf24" } });
      const body = (await get(h, "/api/theming/current", { host: "venue.test" })).json<{
        revision: number;
        tokens: { colors: Record<string, string> };
      }>();
      expect(body.revision).toBe(1);
      expect(body.tokens.colors.primary).toBe("#3b82f6");
    });

    it("lets guests read a public event without asking admin about a session", async () => {
      const res = await get(h, "/api/theming/current", { host: "beta.test", session: "down" });
      expect(res.statusCode).toBe(200);
      const closed = await get(h, "/api/theming/current", { host: "closed.test", session: "down" });
      expect(closed.statusCode).toBe(503);
    });

    it("follows the info-page mode: venue only, then sign-in", async () => {
      expect((await get(h, "/api/theming/current", { host: "venue.test" })).statusCode).toBe(200);
      const outside = await get(h, "/api/theming/current", { host: "venue.test", ip: OUTSIDE_IP });
      expect(outside.statusCode).toBe(403);
      const closed = await get(h, "/api/theming/current", { host: "closed.test" });
      expect(closed.statusCode).toBe(403);
      const member = await get(h, "/api/theming/current", {
        host: "closed.test",
        session: "member",
      });
      expect(member.statusCode).toBe(200);
      const expired = await get(h, "/api/theming/current", {
        host: "closed.test",
        session: "gone",
      });
      expect(expired.statusCode).toBe(403);
    });

    it("is 404 on a hostname that is no event", async () => {
      expect((await get(h, "/api/theming/current", { host: "nope.test" })).statusCode).toBe(404);
    });
  });

  describe("served files", () => {
    it("serves a revision file immutable, with nosniff and same-origin CORP", async () => {
      const { tokensCss } = await seedRevision(h, "beta", 1);
      const res = await get(h, `/theming/a/${tokensCss}`, { host: "beta.test" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/css; charset=utf-8");
      expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
      expect(res.headers["content-security-policy"]).toBeUndefined();
    });

    it("never serves another event's file", async () => {
      const { css } = await seedRevision(h, "alpha", 3, {}, { css: Buffer.from(".t-only-a{}") });
      expect((await get(h, `/theming/a/${css ?? ""}`)).statusCode).toBe(200);
      const leak = await get(h, `/theming/a/${css ?? ""}`, { host: "beta.test" });
      expect(leak.statusCode).toBe(404);
      expect(code(leak)).toBe("not_found");
    });

    it("refuses names outside the served pattern", async () => {
      for (const name of ["x.css", `${"a".repeat(64)}.html`, `${"a".repeat(64)}.js`]) {
        expect((await get(h, `/theming/a/${name}`)).statusCode).toBe(404);
      }
      // The kit refuses an encoded path separator before any route runs.
      expect((await get(h, "/theming/a/..%2Fx")).statusCode).toBe(400);
    });

    it("serves draft files only under /theming/draft/, to theming.theme.write, never cached", async () => {
      const { draftFile } = await seedRevision(
        h,
        "alpha",
        4,
        {},
        { draftFile: { bytes: SVG, ext: "svg" } },
      );
      const url = `/theming/draft/${draftFile ?? ""}`;
      expect((await get(h, `/theming/a/${draftFile ?? ""}`)).statusCode).toBe(404);
      expect((await get(h, url)).statusCode).toBe(401);
      expect((await get(h, url, { session: "member" })).statusCode).toBe(403);
      const res = await get(h, url, { session: "admin" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["content-type"]).toBe("image/svg+xml");
      expect(res.headers["content-security-policy"]).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
      expect(res.headers["content-disposition"]).toBe("attachment");
      expect((await get(h, url, { host: "beta.test", session: "admin" })).statusCode).toBe(404);
    });

    it("keeps draft files behind the admin address rule", async () => {
      const { draftFile } = await seedRevision(
        h,
        "zeta",
        1,
        {},
        { draftFile: { bytes: SVG, ext: "svg" } },
      );
      const res = await get(h, `/theming/draft/${draftFile ?? ""}`, {
        host: "zeta.test",
        ip: OUTSIDE_IP,
        session: "admin",
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("tenant isolation", () => {
    // Several columns only take hashes or numbers, so each marker is stored as a value derived from
    // it, and a row read back is matched to its marker through that value.
    let n = 700000;
    const hex = (m: string): string => createHash("sha256").update(m).digest("hex");
    const tables: [string, string, (marker: string) => string][] = [
      ["theming_drafts", "(draft_key, manifest) VALUES ($1, '{}')", (m) => m],
      [
        "theming_revisions",
        "(revision, manifest, tokens, tokens_css, admin_tokens_css, embed_color, actor_user_id) VALUES (90, '{}', '{}', 'x', 'x', 0, $1)",
        (m) => m,
      ],
      ["theming_files", "(sha256, ext, bytes) VALUES ($1, 'css', 1)", hex],
      ["theming_file_refs", "(owner, file) VALUES ('draft', $1 || '.css')", hex],
      ["theming_pins", "(theme_revision) VALUES ($1::integer)", () => String((n += 1))],
      [
        "theming_embed_files",
        "(owner, embed, path, file, entry) VALUES ('draft', 'e', 'a.js', $1 || '.js', false)",
        hex,
      ],
    ];
    for (const [table, insert, stored] of tables) {
      it(`${table} rows stay in their event`, async () => {
        const markerOf = new Map<string, string>();
        await assertTenantIsolation({
          seed: (_tenant, marker) => {
            const value = stored(marker);
            markerOf.set(value, marker);
            return h.db.tenant(async (c) => {
              await c.query(`DELETE FROM ${table}`);
              await c.query(`INSERT INTO ${table} ${insert}`, [value]);
            });
          },
          read: () =>
            h.db.tenant(async (c) => {
              const { rows } = await c.query(`SELECT * FROM ${table}`);
              return rows.flatMap((row) =>
                Object.values(row).map((v) => markerOf.get(String(v).replace(/\.(css|js)$/, ""))),
              );
            }),
        });
      });
    }
  });
});
