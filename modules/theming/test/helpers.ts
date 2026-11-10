/** A theming app on a real Postgres (RLS needs one) with fake tenants and admin, files in a temp dir. */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { parse as parseYaml } from "yaml";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import {
  AdminClient,
  Bus,
  RightsChecker,
  ServiceIdentity,
  TenantResolver,
  createHealth,
  createLogger,
  runMigrations,
  withTenant,
} from "@canccu/kit";
import type { Event, StorageQuota, TenantContext } from "@canccu/kit";
import { MemoryStreamStore, requireTestDatabase } from "@canccu/kit/testing";
import type { AuditEntry } from "../src/audit.js";
import { buildApp } from "../src/app.js";
import { MIGRATIONS_DIR, poolDb } from "../src/db.js";
import { putEmbed } from "../src/embeds.js";
import type { Db } from "../src/db.js";
import { diskFiles } from "../src/files.js";
import type { FileStore } from "../src/files.js";
import { adminTokens, fillTokens, tokensCss } from "../src/tokens.js";
import { fakeQuota } from "./quota.js";
import type { PartialTokens } from "../src/tokens.js";

/** Tests run only on a database named `*_test` (the harness refuses any other). */
export const DATABASE_URL = process.env.CANCCU_DATABASE_URL;

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
  "archived.test": context("archived", { status: "archived" }),
  // The browser tests: a browser sends fetch metadata over plain http only to localhost.
  localhost: context("local"),
};

/** Profile themes by event; only `venue` has one. */
const PROFILES: Record<string, PartialTokens> = { venue: { colors: { primary: "#14b8a6" } } };

const SESSIONS: Record<string, string[]> = {
  admin: ["theming.theme.write"],
  embedder: ["theming.theme.write", "theming.embeds.write"],
  member: [],
};

function fakeTenants(url: string | URL | Request): Promise<Response> {
  const parsed = new URL(url instanceof Request ? url.url : url);
  const byId = /^\/internal\/tenants\/tenants\/([a-z0-9-]+)$/.exec(parsed.pathname)?.[1];
  const host = parsed.searchParams.get("host") ?? "";
  const ctx = byId ? Object.values(TENANTS).find((t) => t.tenant_id === byId) : TENANTS[host];
  return Promise.resolve(ctx ? Response.json(ctx) : new Response("{}", { status: 404 }));
}

const SERVICE_KEY = "k".repeat(32);
/** The service identity of another module calling theming's internal paths. */
export function caller(module: string): Record<string, string> {
  return new ServiceIdentity({ module, key: SERVICE_KEY }).headers("theming");
}

function fakeAdmin(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const cookie = (init?.headers as Record<string, string> | undefined)?.cookie ?? "";
  const id = cookie.replace("canccu_session=", "");
  // An admin that fails, as one that is restarting does.
  if (id === "down") return Promise.resolve(new Response("{}", { status: 502 }));
  const rights = SESSIONS[id];
  if (rights === undefined) {
    return Promise.resolve(
      Response.json({ error: { code: "not_signed_in", message: "no" } }, { status: 401 }),
    );
  }
  return Promise.resolve(
    Response.json({
      user: { id: `u_${id}`, name: "Someone" },
      rights,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  );
}

export interface Harness {
  app: FastifyInstance;
  db: Db;
  pool: pg.Pool;
  files: FileStore;
  /** The files volume's root. */
  root: string;
  /** The fake storage quota: bytes per tenant, and the limit each gets (default 2 GiB). */
  storage: { used: Record<string, number>; quota: Record<string, number> };
  /** The fake quota itself, for calls made outside a request. */
  quota: StorageQuota;
  /** Audit entries appended so far; `auditDown` makes the next appends fail. */
  audit: AuditEntry[];
  auditDown: boolean;
  /** The events theming published to one event's stream. */
  events(tenant: string): Event[];
  store: MemoryStreamStore;
  close(): Promise<void>;
}

/** Fresh tables per file, migrated by the module's own files, as at start. */
export async function harness(opts: { ipMode?: boolean } = {}): Promise<Harness> {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  // finally: a refused database must not leave the client open and hold the run.
  try {
    await requireTestDatabase(admin);
    await admin.query(
      "DROP TABLE IF EXISTS theming_files, theming_drafts, theming_revisions, theming_file_refs, theming_pins, theming_embed_files, theming_package_files, theming_migrations CASCADE",
    );
    await runMigrations(admin, MIGRATIONS_DIR, { ledger: "theming_migrations", lock: 2 });
  } finally {
    await admin.end();
  }
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const root = await mkdtemp(join(tmpdir(), "canccu-theming-"));
  const db = poolDb(pool);
  const files = diskFiles(root);
  const store = new MemoryStreamStore();
  const audit: AuditEntry[] = [];
  const state = { auditDown: false };
  const { storage, quota } = fakeQuota();
  const app = buildApp({
    db,
    files,
    storage: quota,
    bus: new Bus(store, "theming"),
    log: createLogger("theming"),
    service: new ServiceIdentity({ module: "theming", key: SERVICE_KEY }),
    audit: (entry) => {
      if (state.auditDown) return Promise.reject(new Error("tenants down"));
      audit.push(entry);
      return Promise.resolve();
    },
    profile: (tenant) => Promise.resolve(PROFILES[tenant]),
    rights: new RightsChecker(new AdminClient("http://admin", { fetch: fakeAdmin })),
    tenants: new TenantResolver({ tenantsUrl: "http://tenants", fetch: fakeTenants }),
    health: createHealth({ module: "theming", version: "dev", checks: {} }),
    ipMode: opts.ipMode ?? false,
  });
  await app.ready();
  return {
    app,
    db,
    pool,
    files,
    root,
    storage,
    quota,
    audit,
    store,
    get auditDown() {
      return state.auditDown;
    },
    set auditDown(down: boolean) {
      state.auditDown = down;
    },
    events: (tenant) =>
      (store.streams.get(`t:${tenant}:events:theming`) ?? []).map(
        ([, fields]) => JSON.parse(fields.event ?? "{}") as Event,
      ),
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
        `INSERT INTO theming_revisions (revision, manifest, tokens, tokens_css, admin_tokens_css, css,
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
          `INSERT INTO theming_file_refs (owner, file) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [`r:${revision}`, file],
        );
      }
      let draftFile: string | undefined;
      if (extra.draftFile) {
        draftFile = await h.files.put(c, extra.draftFile.bytes, extra.draftFile.ext);
        await c.query(`INSERT INTO theming_file_refs (owner, file) VALUES ('draft', $1)`, [
          draftFile,
        ]);
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

/** An embed as a package holds it: package paths (`embeds/<name>/…`) to bytes. */
export interface EmbedFiles {
  entry: string;
  files: Record<string, Buffer>;
}

/** The level-up demo theme's `drift` embed, read from events/demo as a package upload would. */
export async function demoEmbed(theme: string, name: string): Promise<EmbedFiles> {
  const root = new URL(`../../../events/demo/themes/${theme}/`, import.meta.url).pathname;
  const manifest = parseYaml(await readFile(join(root, "theme.yaml"), "utf8")) as {
    embeds: Record<string, { entry: string; files?: string[] }>;
  };
  const embed = manifest.embeds[name];
  if (embed === undefined) throw new Error(`no embed ${name} in ${theme}`);
  const files: Record<string, Buffer> = {};
  for (const path of [embed.entry, ...(embed.files ?? [])]) {
    files[path] = await readFile(join(root, path));
  }
  return { entry: embed.entry, files };
}

/**
 * Publish a revision with embeds, or fill the draft with them, the way publish (#241) and package
 * uploads (#244) will: through putEmbed, owned by `r:<revision>` or `draft`.
 */
export function seedEmbeds(
  h: Harness,
  tenant: string,
  owner: { revision: number } | { draftKey: string },
  embeds: Record<string, EmbedFiles>,
): Promise<void> {
  return withTenant(tenant, () =>
    h.db.tenant(async (c) => {
      const manifest = JSON.stringify({
        name: "Seeded",
        embeds: Object.fromEntries(
          Object.entries(embeds).map(([name, e]) => [
            name,
            { entry: e.entry, files: Object.keys(e.files).filter((p) => p !== e.entry) },
          ]),
        ),
      });
      if ("revision" in owner) {
        await c.query(
          `INSERT INTO theming_revisions (revision, manifest, tokens, tokens_css, admin_tokens_css,
                                          embed_color)
           VALUES ($1, $2, $3, 'x.css', 'x.css', 0)`,
          [owner.revision, manifest, JSON.stringify(fillTokens({}))],
        );
      } else {
        await c.query(`INSERT INTO theming_drafts (draft_key, manifest) VALUES ($1, $2)`, [
          owner.draftKey,
          manifest,
        ]);
      }
      const ownerName = "revision" in owner ? `r:${owner.revision}` : "draft";
      for (const [name, e] of Object.entries(embeds)) {
        await putEmbed(c, h.files, ownerName, name, e.entry, new Map(Object.entries(e.files)));
      }
    }),
  );
}

export interface Call {
  host?: string;
  ip?: string;
  session?: string;
}

export function get(
  h: Harness,
  url: string,
  c: Call = {},
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method: "GET",
    url,
    headers: {
      ...headers,
      host: c.host ?? "alpha.test",
      "x-forwarded-for": c.ip ?? VENUE_IP,
      ...(c.session ? { cookie: `canccu_session=${c.session}` } : {}),
    },
  });
}

/** A write as the admin pages make it: JSON body, the event's own hostname. */
export function send(
  h: Harness,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
  c: Call = {},
): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method,
    url,
    headers: {
      host: c.host ?? "alpha.test",
      "x-forwarded-for": c.ip ?? VENUE_IP,
      ...(c.session === undefined ? { cookie: "canccu_session=admin" } : {}),
      ...(c.session ? { cookie: `canccu_session=${c.session}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
}

export function code(res: LightMyRequestResponse): string {
  return res.json<{ error: { code: string } }>().error.code;
}

/** A request whose path reaches the server byte for byte, as no browser or inject() sends it. */
export async function raw(
  h: Harness,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  if (!h.app.server.listening) await h.app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = h.app.server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, headers: { ...headers, host: "alpha.test" } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}
