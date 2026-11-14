/** Drafts and their one write path (contracts/theming.md, Draft, preview, publish; plan D3). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTenant } from "@canccu/kit";
import { COLOR_TOKENS } from "@canccu/ui";
import { DATABASE_URL, OUTSIDE_IP, code, get, harness, seedRevision, send } from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Problem {
  severity: string;
  code: string;
  path?: string;
  message: string;
}
interface DraftBody {
  draft_version: number;
  base_revision: number;
  mode: string;
  manifest: Record<string, unknown> & { tokens: Record<string, unknown>; layouts?: unknown[] };
  problems: Problem[];
  updated_at: string;
  updated_by: string;
}

const LAYOUT = {
  id: "main",
  name: "Main",
  aspect: "16:9",
  grid: { columns: 4, rows: 3 },
  regions: [
    { id: "top", area: { column: 1, row: 1, columns: 4, rows: 1 }, widgets: [{ widget: "clock" }] },
  ],
};

describe.skipIf(!DATABASE_URL)("theming drafts", () => {
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
          await c.query("DELETE FROM theming_drafts");
          await c.query("DELETE FROM theming_revisions");
          await c.query("DELETE FROM theming_file_refs");
        }),
      );
    }
  });

  const fresh = async (from = "defaults"): Promise<DraftBody> => {
    const res = await send(h, "POST", "/api/theming/draft", { from });
    expect(res.statusCode).toBe(201);
    return res.json<DraftBody>();
  };

  describe("starting one", () => {
    it("from the defaults: a valid simple theme with a generated brand", async () => {
      const draft = await fresh();
      expect(draft).toMatchObject({
        draft_version: 1,
        base_revision: 0,
        mode: "simple",
        problems: [],
        updated_by: "u_admin",
        manifest: {
          schema_version: 1,
          mode: "simple",
          brand: { primary: COLOR_TOKENS.primary, accent: COLOR_TOKENS.accent, scheme: "dark" },
        },
      });
      const read = await get(h, "/api/theming/draft", { session: "admin" });
      expect(read.json()).toEqual(draft);
    });

    it("from the current revision, or an earlier one", async () => {
      await seedRevision(h, "alpha", 1, { colors: { accent: "#fbbf24" } });
      await seedRevision(h, "alpha", 2);
      const current = await fresh("current");
      expect(current.base_revision).toBe(2);
      expect(current.manifest).toMatchObject({ name: "Seeded" });
      await send(h, "DELETE", "/api/theming/draft?draft_version=1");
      const res = await send(h, "POST", "/api/theming/draft", { from: "revision", revision: 1 });
      expect(res.statusCode).toBe(201);
      expect(res.json<DraftBody>().base_revision).toBe(1);
    });

    it("from current without a revision is the defaults", async () => {
      expect((await fresh("current")).base_revision).toBe(0);
    });

    it("refuses a second draft, an unknown revision and a bad body", async () => {
      await fresh();
      expect(code(await send(h, "POST", "/api/theming/draft", { from: "defaults" }))).toBe(
        "draft_exists",
      );
      await send(h, "DELETE", "/api/theming/draft?draft_version=1");
      const unknown = await send(h, "POST", "/api/theming/draft", {
        from: "revision",
        revision: 7,
      });
      expect([unknown.statusCode, code(unknown)]).toEqual([404, "not_found"]);
      for (const body of [{ from: "revision" }, { from: "nope" }, { from: "defaults", x: 1 }]) {
        const bad = await send(h, "POST", "/api/theming/draft", body);
        expect([bad.statusCode, code(bad)]).toEqual([400, "invalid_request"]);
      }
    });

    it("answers 404 no_draft without one", async () => {
      const res = await get(h, "/api/theming/draft", { session: "admin" });
      expect([res.statusCode, code(res)]).toEqual([404, "no_draft"]);
      const patch = await send(h, "PATCH", "/api/theming/draft/tokens", {
        draft_version: 1,
        tokens: { colors: { text: "#ffffff" } },
      });
      expect(code(patch)).toBe("no_draft");
    });
  });

  describe("tokens", () => {
    it("merges, removes with null, and makes the theme advanced", async () => {
      await fresh();
      const res = await send(h, "PATCH", "/api/theming/draft/tokens", {
        draft_version: 1,
        tokens: { colors: { accent: "#fbbf24", primary: null }, sizes: { radius: "0" } },
      });
      expect(res.statusCode).toBe(200);
      const draft = res.json<DraftBody>();
      expect(draft.draft_version).toBe(2);
      expect(draft.mode).toBe("advanced");
      const colors = draft.manifest.tokens.colors as Record<string, string>;
      expect(colors.accent).toBe("#fbbf24");
      expect(colors).not.toHaveProperty("primary");
      expect(draft.manifest.tokens.sizes).toEqual({ radius: "0" });
    });

    it("keeps simple when tokens are only removed", async () => {
      await fresh();
      const res = await send(h, "PATCH", "/api/theming/draft/tokens", {
        draft_version: 1,
        tokens: { colors: { accent: null } },
      });
      expect(res.json<DraftBody>().mode).toBe("simple");
    });

    it("keeps simple when only motion changes", async () => {
      await fresh();
      const res = await send(h, "PATCH", "/api/theming/draft/tokens", {
        draft_version: 1,
        tokens: { motion: "calm" },
      });
      const draft = res.json<DraftBody>();
      expect([draft.mode, draft.manifest.tokens.motion]).toEqual(["simple", "calm"]);
    });

    it("keeps simple when only the motion style changes, and a null field goes back to its default", async () => {
      await fresh();
      const set = await send(h, "PATCH", "/api/theming/draft/tokens", {
        draft_version: 1,
        tokens: { motion_style: { speed: "faster", pack: "arcade" } },
      });
      const draft = set.json<DraftBody>();
      expect([draft.mode, draft.manifest.tokens.motion_style]).toEqual([
        "simple",
        { speed: "faster", pack: "arcade" },
      ]);
      const field = await send(h, "PATCH", "/api/theming/draft/tokens", {
        draft_version: 2,
        tokens: { motion_style: { speed: null, spotlight: "trace" } },
      });
      expect(field.json<DraftBody>().manifest.tokens.motion_style).toEqual({
        pack: "arcade",
        spotlight: "trace",
      });
      const reset = await send(h, "PATCH", "/api/theming/draft/tokens", {
        draft_version: 3,
        tokens: { motion_style: null },
      });
      expect(reset.json<DraftBody>().manifest.tokens).not.toHaveProperty("motion_style");
    });

    it("refuses an unknown token or a bad value and changes nothing", async () => {
      await fresh();
      for (const tokens of [
        { colors: { nope: "#ffffff" } },
        { colors: { text: "red" } },
        { sizes: { gap: "1vh" } },
        { fonts: { body: "a;b" } },
        { motion: "fast" },
        { motion_style: { speed: "ludicrous" } },
        { motion_style: { tempo: "normal" } },
        { shadows: {} },
      ]) {
        const res = await send(h, "PATCH", "/api/theming/draft/tokens", {
          draft_version: 1,
          tokens,
        });
        expect([res.statusCode, code(res)]).toEqual([400, "invalid_request"]);
      }
      const read = await get(h, "/api/theming/draft", { session: "admin" });
      expect(read.json<DraftBody>().draft_version).toBe(1);
    });

    it("warns contrast_low and never blocks", async () => {
      await fresh();
      const res = await send(h, "PATCH", "/api/theming/draft/tokens", {
        draft_version: 1,
        tokens: { colors: { text: "#0f172a" } },
      });
      const problems = res.json<DraftBody>().problems;
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.every((p) => p.severity === "warning" && p.code === "contrast_low")).toBe(
        true,
      );
      expect(problems.map((p) => p.message).join(" ")).toContain("text on background");
    });

    it("refuses a stale draft_version with 409 version_conflict", async () => {
      await fresh();
      const edit = { draft_version: 1, tokens: { colors: { accent: "#fbbf24" } } };
      expect((await send(h, "PATCH", "/api/theming/draft/tokens", edit)).statusCode).toBe(200);
      const stale = await send(h, "PATCH", "/api/theming/draft/tokens", edit);
      expect([stale.statusCode, code(stale)]).toEqual([409, "version_conflict"]);
    });
  });

  describe("layouts", () => {
    it("adds, replaces and removes one, each a new version with a new draft key", async () => {
      await fresh();
      const key = async (): Promise<string> =>
        withTenant("alpha", () =>
          h.db.tenant(async (c) => {
            const { rows } = await c.query("SELECT draft_key FROM theming_drafts");
            return (rows[0] as { draft_key: string }).draft_key;
          }),
        );
      const before = await key();
      const put = await send(h, "PUT", "/api/theming/draft/layouts/main?draft_version=1", LAYOUT);
      expect(put.statusCode).toBe(200);
      expect(put.json<DraftBody>().manifest.layouts).toEqual([LAYOUT]);
      expect(await key()).not.toBe(before);
      const renamed = { ...LAYOUT, name: "Renamed" };
      const again = await send(
        h,
        "PUT",
        "/api/theming/draft/layouts/main?draft_version=2",
        renamed,
      );
      expect(again.json<DraftBody>().manifest.layouts).toEqual([renamed]);
      const gone = await send(h, "DELETE", "/api/theming/draft/layouts/main?draft_version=3");
      expect(gone.json<DraftBody>()).toMatchObject({ draft_version: 4, manifest: { layouts: [] } });
      const missing = await send(h, "DELETE", "/api/theming/draft/layouts/main?draft_version=4");
      expect([missing.statusCode, code(missing)]).toEqual([404, "not_found"]);
    });

    it("refuses a body that is no layout, or names another id", async () => {
      await fresh();
      for (const body of [
        { ...LAYOUT, id: "other" },
        { ...LAYOUT, grid: { columns: 99, rows: 1 } },
        { id: "main" },
      ]) {
        const res = await send(h, "PUT", "/api/theming/draft/layouts/main?draft_version=1", body);
        expect([res.statusCode, code(res)]).toEqual([400, "invalid_request"]);
      }
      const noVersion = await send(h, "PUT", "/api/theming/draft/layouts/main", LAYOUT);
      expect(code(noVersion)).toBe("invalid_request");
    });

    it("reports what the schema cannot check as problems", async () => {
      await fresh();
      const layout = {
        ...LAYOUT,
        regions: [
          {
            id: "a",
            area: { column: 3, row: 1, columns: 3, rows: 1 },
            widgets: [{ widget: "clock", template: "big" }],
          },
          {
            id: "a",
            area: { column: 1, row: 1, columns: 1, rows: 1 },
            widgets: [{ widget: "laser_show" }],
          },
          {
            id: "b",
            area: { column: 1, row: 2, columns: 1, rows: 1 },
            widgets: [{ widget: "logo" }, { widget: "embed", embed: "drift" }],
          },
        ],
      };
      const res = await send(h, "PUT", "/api/theming/draft/layouts/main?draft_version=1", layout);
      const problems = res.json<DraftBody>().problems.map((p) => [p.severity, p.code, p.path]);
      expect(problems).toEqual(
        expect.arrayContaining([
          ["error", "area_outside_grid", "theme.yaml#/layouts/0/regions/0"],
          ["error", "reference_unknown", "theme.yaml#/layouts/0/regions/0/widgets/0"],
          ["error", "duplicate_id", "theme.yaml#/layouts/0/regions/1"],
          ["warning", "widget_unknown", "theme.yaml#/layouts/0/regions/1/widgets/0"],
          ["error", "reference_unknown", "theme.yaml#/layouts/0/regions/2/widgets/0"],
          ["error", "reference_unknown", "theme.yaml#/layouts/0/regions/2/widgets/1"],
        ]),
      );
      expect(problems).toHaveLength(6);
    });

    it("reports a layout id used twice", async () => {
      await withTenant("alpha", () =>
        h.db.tenant((c) =>
          c.query(
            `INSERT INTO theming_drafts (draft_key, manifest, updated_by) VALUES ('k'||md5(random()::text), $1, 'u_admin')`,
            [
              JSON.stringify({
                schema_version: 1,
                name: "Twice",
                mode: "advanced",
                tokens: {},
                layouts: [LAYOUT, LAYOUT],
              }),
            ],
          ),
        ),
      );
      const res = await send(h, "PATCH", "/api/theming/draft/tokens", {
        draft_version: 1,
        tokens: {},
      });
      const problems = res.json<DraftBody>().problems.map((p) => [p.code, p.path]);
      expect(problems).toContainEqual(["duplicate_id", "theme.yaml#/layouts/1"]);
    });
  });

  describe("discarding", () => {
    it("takes draft_version and removes the draft and what it refers to", async () => {
      await fresh();
      await withTenant("alpha", () =>
        h.db.tenant((c) =>
          c.query(`INSERT INTO theming_file_refs (owner, file) VALUES ('draft', $1)`, [
            `${"a".repeat(64)}.png`,
          ]),
        ),
      );
      const stale = await send(h, "DELETE", "/api/theming/draft?draft_version=2");
      expect(code(stale)).toBe("version_conflict");
      const res = await send(h, "DELETE", "/api/theming/draft?draft_version=1");
      expect(res.statusCode).toBe(204);
      expect(code(await get(h, "/api/theming/draft", { session: "admin" }))).toBe("no_draft");
      const refs = await withTenant("alpha", () =>
        h.db.tenant(
          async (c) =>
            (await c.query(`SELECT * FROM theming_file_refs WHERE owner = 'draft'`)).rows,
        ),
      );
      expect(refs).toEqual([]);
    });
  });

  describe("who may", () => {
    it("needs a session with theming.theme.write, within the admin address rule", async () => {
      const anon = await send(
        h,
        "POST",
        "/api/theming/draft",
        { from: "defaults" },
        { session: "" },
      );
      expect(anon.statusCode).toBe(401);
      const member = await send(
        h,
        "POST",
        "/api/theming/draft",
        { from: "defaults" },
        { session: "member" },
      );
      expect([member.statusCode, code(member)]).toEqual([403, "missing_right"]);
      expect((await get(h, "/api/theming/draft", { session: "member" })).statusCode).toBe(403);
      const outside = await send(
        h,
        "POST",
        "/api/theming/draft",
        { from: "defaults" },
        { host: "zeta.test", ip: OUTSIDE_IP },
      );
      expect(outside.statusCode).toBe(403);
    });

    it("refuses every write on an archived event with 409 event_archived", async () => {
      const on = { host: "archived.test" };
      for (const [method, url, body] of [
        ["POST", "/api/theming/draft", { from: "defaults" }],
        ["PATCH", "/api/theming/draft/tokens", { draft_version: 1, tokens: {} }],
        ["PUT", "/api/theming/draft/layouts/main?draft_version=1", LAYOUT],
        ["DELETE", "/api/theming/draft/layouts/main?draft_version=1", undefined],
        ["DELETE", "/api/theming/draft?draft_version=1", undefined],
      ] as const) {
        const res = await send(h, method, url, body, on);
        expect([url, res.statusCode, code(res)]).toEqual([url, 409, "event_archived"]);
      }
    });

    it("keeps each event's draft to itself", async () => {
      await fresh();
      expect(
        code(await get(h, "/api/theming/draft", { host: "beta.test", session: "admin" })),
      ).toBe("no_draft");
      const theirs = await send(
        h,
        "PATCH",
        "/api/theming/draft/tokens",
        { draft_version: 1, tokens: {} },
        { host: "beta.test" },
      );
      expect(code(theirs)).toBe("no_draft");
      expect(
        (await send(h, "POST", "/api/theming/draft", { from: "defaults" }, { host: "beta.test" }))
          .statusCode,
      ).toBe(201);
    });
  });
});
