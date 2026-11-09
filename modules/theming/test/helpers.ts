/** A theming app on a real Postgres (RLS needs one) with fake tenants and admin, files in a temp dir. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import {
  AdminClient,
  RightsChecker,
  TenantResolver,
  createHealth,
  runMigrations,
  withTenant,
} from "@canccu/kit";
import type { TenantContext } from "@canccu/kit";
import { buildApp } from "../src/app.js";
import { MIGRATIONS_DIR, poolDb } from "../src/db.js";
import type { Db } from "../src/db.js";
import { diskFiles } from "../src/files.js";
import type { FileStore } from "../src/files.js";
import { builtins } from "../src/theme.js";
import { adminTokens, fillTokens, tokensCss } from "../src/tokens.js";
import type { PartialTokens } from "../src/tokens.js";

/** Tests run only with a Postgres to spare; never point this at a database you keep. */
export const DATABASE_URL = process.env.CANCCU_TEST_DATABASE_URL;

export const VENUE_IP = "10.0.0.5";
export const OUTSIDE_IP = "192.0.2.9";

function context(id: string, overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenant_id: id,
    status: "live",
    primary_hostname: `${id}.test`,
    time_zone: "UTC",
    info_page_mode: "public",
    membership: "open",
    admin_access: "internet",
    venue: { id: "v_1", name: "Demo Hall", addresses: ["10.0.0.0/24"] },
    venue_ip_check: { enabled: true, disabled_until: null, reason: null },
    flags_version: 1,
    flags: {},
    ...overrides,
  };
}

const TENANTS: Record<string, TenantContext> = {
  "alpha.test": context("alpha"),
  "beta.test": context("beta"),
  "venue.test": context("venue", { info_page_mode: "venue_only" }),
  "closed.test": context("closed", { info_page_mode: "sign_in" }),
  "zeta.test": context("zeta", { admin_access: "restricted" }),
};

const SESSIONS: Record<string, string[]> = { admin: ["theming.theme.write"], member: [] };

function fakeTenants(url: string | URL | Request): Promise<Response> {
  const host = new URL(url instanceof Request ? url.url : url).searchParams.get("host") ?? "";
  const ctx = TENANTS[host];
  return Promise.resolve(ctx ? Response.json(ctx) : new Response("{}", { status: 404 }));
}

function fakeAdmin(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const cookie = (init?.headers as Record<string, string> | undefined)?.cookie ?? "";
  const rights = SESSIONS[cookie.replace("canccu_session=", "")];
  if (rights === undefined) {
    return Promise.resolve(
      Response.json({ error: { code: "not_signed_in", message: "no" } }, { status: 401 }),
    );
  }
  return Promise.resolve(
    Response.json({
      user: { id: "u_1", name: "Someone" },
      rights,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  );
}

export interface Harness {
  app: FastifyInstance;
  db: Db;
  files: FileStore;
  close(): Promise<void>;
}

/** Fresh tables per file, migrated by the module's own files, as at start. */
export async function harness(): Promise<Harness> {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  await admin.query(
    "DROP TABLE IF EXISTS files, drafts, revisions, file_refs, pins, theming_migrations CASCADE",
  );
  await runMigrations(admin, MIGRATIONS_DIR, { ledger: "theming_migrations", lock: 2 });
  await admin.end();
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const root = await mkdtemp(join(tmpdir(), "canccu-theming-"));
  const db = poolDb(pool);
  const files = diskFiles(root);
  const app = buildApp({
    db,
    files,
    builtins: builtins(),
    rights: new RightsChecker(new AdminClient("http://admin", { fetch: fakeAdmin })),
    tenants: new TenantResolver({ tenantsUrl: "http://tenants", fetch: fakeTenants }),
    health: createHealth({ module: "theming", version: "dev", checks: {} }),
  });
  await app.ready();
  return {
    app,
    db,
    files,
    close: async () => {
      await app.close();
      await pool.end();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * Publish a revision the way the publish slice (#241) will store one: the generated token CSS as
 * files referred to by the revision. Returns the served names.
 */
export function seedRevision(
  h: Harness,
  tenant: string,
  revision: number,
  given: PartialTokens = {},
  extra: { css?: Buffer; draftFile?: { bytes: Buffer; ext: "svg" | "png" } } = {},
): Promise<{ tokensCss: string; adminCss: string; css?: string; draftFile?: string }> {
  return withTenant(tenant, () =>
    h.db.tenant(async (c) => {
      const tokens = fillTokens(given);
      const tokensName = await h.files.put(c, Buffer.from(tokensCss(tokens)), "css");
      const adminName = await h.files.put(c, Buffer.from(tokensCss(adminTokens(tokens))), "css");
      const cssName = extra.css ? await h.files.put(c, extra.css, "css") : undefined;
      await c.query(
        `INSERT INTO revisions (revision, manifest, tokens, tokens_css, admin_tokens_css, css,
                                embed_color)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          revision,
          JSON.stringify({ name: "Seeded", layouts: [{ id: "main" }] }),
          JSON.stringify(tokens),
          tokensName,
          adminName,
          cssName ?? null,
          0x3b82f6,
        ],
      );
      for (const file of [tokensName, adminName, cssName].filter((f) => f !== undefined)) {
        await c.query(
          `INSERT INTO file_refs (owner, file) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [`r:${revision}`, file],
        );
      }
      let draftFile: string | undefined;
      if (extra.draftFile) {
        draftFile = await h.files.put(c, extra.draftFile.bytes, extra.draftFile.ext);
        await c.query(`INSERT INTO file_refs (owner, file) VALUES ('draft', $1)`, [draftFile]);
      }
      return {
        tokensCss: tokensName,
        adminCss: adminName,
        ...(cssName ? { css: cssName } : {}),
        ...(draftFile ? { draftFile } : {}),
      };
    }),
  );
}

export interface Call {
  host?: string;
  ip?: string;
  session?: string;
}

export function get(h: Harness, url: string, c: Call = {}): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method: "GET",
    url,
    headers: {
      host: c.host ?? "alpha.test",
      "x-forwarded-for": c.ip ?? VENUE_IP,
      ...(c.session ? { cookie: `canccu_session=${c.session}` } : {}),
    },
  });
}

export function code(res: LightMyRequestResponse): string {
  return res.json<{ error: { code: string } }>().error.code;
}
