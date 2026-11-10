/** Publish, restore, the history and the pinned read (contracts/theming.md, Draft, preview, publish). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTenant } from "@canccu/kit";
import {
  DATABASE_URL,
  caller,
  code,
  demoEmbed,
  get,
  harness,
  seedEmbeds,
  seedRevision,
  send,
} from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Revision {
  revision: number;
  name: string;
  mode: string;
  published_at: string;
  actor_user_id: string;
  restored_from?: number;
  pinned: boolean;
  manifest: Record<string, unknown>;
}

describe.skipIf(!DATABASE_URL)("theming publish and revisions", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    h.audit.length = 0;
    h.auditDown = false;
    h.store.streams.clear();
    for (const tenant of ["alpha", "beta", "venue"]) {
      await withTenant(tenant, () =>
        h.db.tenant(async (c) => {
          for (const table of ["drafts", "revisions", "file_refs", "embed_files", "pins"]) {
            await c.query(`DELETE FROM theming_${table}`);
          }
        }),
      );
    }
  });

  /** A draft from the defaults with one token edit, published as `session`. */
  async function publishOne(accent = "#fbbf24", session = "admin"): Promise<Revision> {
    const exists = await get(h, "/api/theming/draft", { session: "admin" });
    if (exists.statusCode === 404)
      await send(h, "POST", "/api/theming/draft", { from: "defaults" });
    const version = (await get(h, "/api/theming/draft", { session: "admin" })).json<{
      draft_version: number;
    }>().draft_version;
    const edited = await send(h, "PATCH", "/api/theming/draft/tokens", {
      draft_version: version,
      tokens: { colors: { accent } },
    });
    const res = await send(
      h,
      "POST",
      "/api/theming/draft/publish",
      { draft_version: edited.json<{ draft_version: number }>().draft_version },
      { session },
    );
    expect(res.statusCode).toBe(201);
    return res.json<Revision>();
  }

  describe("publish", () => {
    it("makes the draft the next revision, current at once, and removes the draft", async () => {
      const rev = await publishOne();
      expect(rev).toMatchObject({
        revision: 1,
        name: "Default",
        mode: "advanced",
        actor_user_id: "u_admin",
        pinned: false,
      });
      expect(rev.manifest).toMatchObject({ tokens: { colors: { accent: "#fbbf24" } } });
      expect(code(await get(h, "/api/theming/draft", { session: "admin" }))).toBe("no_draft");
      const current = (await get(h, "/api/theming/current")).json<
        Record<string, unknown> & { tokens: { colors: Record<string, string> } }
      >();
      expect(current.revision).toBe(1);
      expect(current.tokens.colors.accent).toBe("#fbbf24");
      const css = await get(h, current.tokens_css_url as string);
      expect([css.statusCode, css.body.includes("--canccu-color-accent: #fbbf24;")]).toEqual([
        200,
        true,
      ]);
      expect((await get(h, current.admin_tokens_css_url as string)).statusCode).toBe(200);
    });

    it("announces theming.theme.published with what changed, and audits it", async () => {
      await publishOne();
      const [event] = h.events("alpha");
      expect(event).toMatchObject({
        type: "theming.theme.published",
        version: 1,
        tenant: "alpha",
        data: {
          revision: 1,
          restored_from: null,
          cloned_from: null,
          changed: ["tokens"],
          css_url: null,
          embed_color: 0x3b82f6,
          actor_user_id: "u_admin",
        },
      });
      expect(String(event?.data.tokens_css_url)).toMatch(/^\/theming\/a\/[0-9a-f]{64}\.css$/);
      expect(h.audit).toEqual([
        {
          tenant_id: "alpha",
          actor_user_id: "u_admin",
          action: "theming.theme.published",
          target: { type: "theme_revision", id: "1" },
          changes: { revision: { old: 0, new: 1 } },
        },
      ]);
    });

    it("lists only what differs from the revision before", async () => {
      await publishOne("#fbbf24");
      await send(h, "POST", "/api/theming/draft", { from: "current" });
      const layout = {
        id: "main",
        name: "Main",
        aspect: "16:9",
        grid: { columns: 1, rows: 1 },
        regions: [
          {
            id: "r",
            area: { column: 1, row: 1, columns: 1, rows: 1 },
            widgets: [{ widget: "clock" }],
          },
        ],
      };
      await send(h, "PUT", "/api/theming/draft/layouts/main?draft_version=1", layout);
      const res = await send(h, "POST", "/api/theming/draft/publish", { draft_version: 2 });
      expect(res.json<Revision>().revision).toBe(2);
      expect(h.events("alpha").at(-1)?.data.changed).toEqual(["layouts"]);
      const current = (await get(h, "/api/theming/current")).json<{ layouts: unknown[] }>();
      expect(current.layouts).toEqual([layout]);
    });

    it("refuses a draft with an error: 422 theme_invalid with its problems", async () => {
      await send(h, "POST", "/api/theming/draft", { from: "defaults" });
      await send(h, "PUT", "/api/theming/draft/layouts/main?draft_version=1", {
        id: "main",
        name: "Main",
        aspect: "16:9",
        grid: { columns: 1, rows: 1 },
        regions: [
          {
            id: "r",
            area: { column: 2, row: 1, columns: 1, rows: 1 },
            widgets: [{ widget: "clock" }],
          },
        ],
      });
      const res = await send(h, "POST", "/api/theming/draft/publish", { draft_version: 2 });
      expect(res.statusCode).toBe(422);
      const body = res.json<{ error: { code: string; problems: { code: string }[] } }>();
      expect(body.error.code).toBe("theme_invalid");
      expect(body.error.problems.map((p) => p.code)).toEqual(["area_outside_grid"]);
      expect((await get(h, "/api/theming/current")).json<{ revision: number }>().revision).toBe(0);
      expect(h.events("alpha")).toEqual([]);
    });

    it("refuses a stale draft_version and a missing draft", async () => {
      await send(h, "POST", "/api/theming/draft", { from: "defaults" });
      const stale = await send(h, "POST", "/api/theming/draft/publish", { draft_version: 5 });
      expect([stale.statusCode, code(stale)]).toEqual([409, "version_conflict"]);
      await send(h, "DELETE", "/api/theming/draft?draft_version=1");
      expect(code(await send(h, "POST", "/api/theming/draft/publish", { draft_version: 1 }))).toBe(
        "no_draft",
      );
      expect(code(await send(h, "POST", "/api/theming/draft/publish", {}))).toBe("invalid_request");
    });

    it("publishes nothing when the audit log cannot take the entry", async () => {
      await send(h, "POST", "/api/theming/draft", { from: "defaults" });
      h.auditDown = true;
      const res = await send(h, "POST", "/api/theming/draft/publish", { draft_version: 1 });
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      expect((await get(h, "/api/theming/current")).json<{ revision: number }>().revision).toBe(0);
      expect((await get(h, "/api/theming/draft", { session: "admin" })).statusCode).toBe(200);
      expect(h.events("alpha")).toEqual([]);
    });

    it("carries the draft's files and embeds into the revision, and needs theming.embeds.write for them", async () => {
      const drift = await demoEmbed("level-up", "drift");
      await seedEmbeds(h, "alpha", { draftKey: "k".repeat(32) }, { drift });
      await withTenant("alpha", () =>
        h.db.tenant((c) =>
          c.query(`UPDATE theming_drafts SET updated_by = 'u_admin', manifest = $1`, [
            JSON.stringify({
              schema_version: 1,
              name: "Embeds",
              mode: "advanced",
              tokens: {},
              embeds: { drift: { entry: drift.entry } },
            }),
          ]),
        ),
      );
      const denied = await send(h, "POST", "/api/theming/draft/publish", { draft_version: 1 });
      expect([denied.statusCode, code(denied)]).toEqual([403, "missing_right"]);
      const res = await send(
        h,
        "POST",
        "/api/theming/draft/publish",
        { draft_version: 1 },
        { session: "embedder" },
      );
      expect(res.statusCode).toBe(201);
      const current = (await get(h, "/api/theming/current")).json<{
        embeds: { name: string; frame_url: string }[];
      }>();
      expect(current.embeds).toEqual([
        {
          name: "drift",
          frame_url: expect.stringMatching(/^\/theming\/sandbox\/1\/drift\//) as string,
        },
      ]);
      expect(h.events("alpha").at(-1)?.data.changed).toEqual(["embeds"]);
    });
  });

  describe("restore", () => {
    it("publishes a copy of an earlier revision as the next one", async () => {
      await publishOne("#fbbf24");
      await publishOne("#22d3ee");
      const res = await send(h, "POST", "/api/theming/revisions/1/restore", {
        current_revision: 2,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<Revision>()).toMatchObject({ revision: 3, restored_from: 1 });
      const current = (await get(h, "/api/theming/current")).json<{
        revision: number;
        tokens: { colors: Record<string, string> };
      }>();
      expect([current.revision, current.tokens.colors.accent]).toEqual([3, "#fbbf24"]);
      expect(h.events("alpha").at(-1)?.data).toMatchObject({
        revision: 3,
        restored_from: 1,
        changed: ["tokens"],
      });
      expect(h.audit.at(-1)).toMatchObject({
        action: "theming.theme.restored",
        target: { id: "3" },
        changes: { revision: { old: 2, new: 3 }, restored_from: { old: null, new: 1 } },
      });
    });

    it("refuses when another publish came first, or the revision is not kept", async () => {
      await publishOne();
      const stale = await send(h, "POST", "/api/theming/revisions/1/restore", {
        current_revision: 2,
      });
      expect([stale.statusCode, code(stale)]).toEqual([409, "version_conflict"]);
      const unknown = await send(h, "POST", "/api/theming/revisions/9/restore", {
        current_revision: 1,
      });
      expect([unknown.statusCode, code(unknown)]).toEqual([404, "not_found"]);
      const archived = await send(
        h,
        "POST",
        "/api/theming/revisions/1/restore",
        { current_revision: 1 },
        { host: "archived.test" },
      );
      expect(code(archived)).toBe("event_archived");
      const archivedPublish = await send(
        h,
        "POST",
        "/api/theming/draft/publish",
        { draft_version: 1 },
        { host: "archived.test" },
      );
      expect(code(archivedPublish)).toBe("event_archived");
    });
  });

  describe("history", () => {
    it("lists newest first, paged with before, marking the pinned one", async () => {
      for (const accent of ["#fbbf24", "#22d3ee", "#a3e635"]) await publishOne(accent);
      await withTenant("alpha", () =>
        h.db.tenant((c) => c.query(`INSERT INTO theming_pins (theme_revision) VALUES (2)`)),
      );
      const page = await get(h, "/api/theming/revisions?limit=2", { session: "admin" });
      const body = page.json<{ current_revision: number; revisions: Revision[] }>();
      expect(body.current_revision).toBe(3);
      expect(body.revisions.map((r) => [r.revision, r.pinned])).toEqual([
        [3, false],
        [2, true],
      ]);
      expect(body.revisions[0]).not.toHaveProperty("manifest");
      const older = await get(h, "/api/theming/revisions?before=2", { session: "admin" });
      expect(older.json<{ revisions: Revision[] }>().revisions.map((r) => r.revision)).toEqual([1]);
      for (const q of ["limit=0", "limit=101", "before=x", "before=0"]) {
        expect(code(await get(h, `/api/theming/revisions?${q}`, { session: "admin" }))).toBe(
          "invalid_request",
        );
      }
    });

    it("answers one revision with its manifest, 404 for one not kept", async () => {
      await publishOne();
      const one = await get(h, "/api/theming/revisions/1", { session: "admin" });
      expect(one.json<Revision>()).toMatchObject({ revision: 1, manifest: { name: "Default" } });
      expect(code(await get(h, "/api/theming/revisions/2", { session: "admin" }))).toBe(
        "not_found",
      );
      expect((await get(h, "/api/theming/revisions/1", { session: "member" })).statusCode).toBe(
        403,
      );
      expect((await get(h, "/api/theming/revisions", {})).statusCode).toBe(401);
    });
  });

  describe("GET /internal/theming/revisions/{revision}", () => {
    const internal = (url: string, module = "screen") =>
      h.app.inject({ method: "GET", url, headers: { host: "theming:8080", ...caller(module) } });

    it("answers a kept revision of the named tenant, resolved like current", async () => {
      await publishOne("#fbbf24");
      await publishOne("#22d3ee");
      const res = await internal("/internal/theming/revisions/1?tenant_id=alpha");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        revision: 1,
        theming_version: 1,
        tokens: { colors: { accent: "#fbbf24" } },
        embeds: [],
      });
    });

    it("needs a module's identity, a known tenant and a kept revision", async () => {
      await publishOne();
      const anon = await h.app.inject({
        method: "GET",
        url: "/internal/theming/revisions/1?tenant_id=alpha",
        headers: { host: "theming:8080" },
      });
      expect(anon.statusCode).toBe(401);
      expect(
        (await internal("/internal/theming/revisions/1?tenant_id=alpha", "bot")).statusCode,
      ).toBe(403);
      expect(code(await internal("/internal/theming/revisions/1?tenant_id=nobody"))).toBe(
        "not_found",
      );
      expect(code(await internal("/internal/theming/revisions/1?tenant_id=beta"))).toBe(
        "not_found",
      );
      expect(code(await internal("/internal/theming/revisions/2?tenant_id=alpha"))).toBe(
        "not_found",
      );
      expect(code(await internal("/internal/theming/revisions/1"))).toBe("invalid_request");
      expect(code(await internal("/internal/theming/revisions/x?tenant_id=alpha"))).toBe(
        "invalid_request",
      );
    });
  });

  describe("tenancy", () => {
    it("never shows or restores another event's revisions", async () => {
      await publishOne();
      await seedRevision(h, "beta", 1, { colors: { accent: "#a3e635" } });
      const theirs = await get(h, "/api/theming/revisions", {
        host: "beta.test",
        session: "admin",
      });
      expect(theirs.json<{ revisions: Revision[] }>().revisions.map((r) => r.name)).toEqual([
        "Seeded",
      ]);
      const restored = await send(
        h,
        "POST",
        "/api/theming/revisions/1/restore",
        { current_revision: 1 },
        { host: "beta.test" },
      );
      expect(restored.json<Revision>().manifest).toMatchObject({ name: "Seeded" });
      expect((await get(h, "/api/theming/current")).json<{ revision: number }>().revision).toBe(1);
      expect(h.events("beta").map((e) => e.tenant)).toEqual(["beta"]);
    });
  });
});
