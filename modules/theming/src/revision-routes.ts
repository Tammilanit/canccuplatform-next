/** Publish, restore, the history and the pinned read (contracts/theming.openapi.yaml, draft and revisions). */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ServiceForbidden, isTenantId, requireTenant, withTenant } from "@canccu/kit";
import type { Bus, Logger, RightsChecker, SqlClient, TenantResolver } from "@canccu/kit";
import type { Audit } from "./audit.js";
import { checkManifest, hasError } from "./checks.js";
import type { Manifest } from "./checks.js";
import type { Db } from "./db.js";
import { loadDraft, lockDraft, removeDraft } from "./drafts.js";
import type { FileStore } from "./files.js";
import {
  WRITE,
  actorOf,
  assertWritable,
  invalidRequest,
  needs,
  notFound,
  positiveInt,
  versionConflict,
} from "./http.js";
import { currentRevision, embedsDiffer, lockHistory, writeRevision } from "./publish.js";
import type { ProfileSource } from "./profile.js";
import { fillTokens } from "./tokens.js";
import type { Published, PublishInput } from "./publish.js";
import { resolvedRevision } from "./theme.js";

export interface RevisionDeps {
  db: Db;
  files: FileStore;
  rights: RightsChecker;
  bus: Bus;
  audit: Audit;
  profile: ProfileSource;
  log: Logger;
}

const EMBEDS = "theming.embeds.write";

/** `{"<field>": <positive integer>}` and nothing else. */
function bodyInt(body: unknown, field: string): number {
  const b = body as Record<string, unknown> | null | undefined;
  const value = b?.[field];
  const extra = b !== null && typeof b === "object" && Object.keys(b).some((k) => k !== field);
  if (extra || !Number.isInteger(value) || (value as number) < 1) {
    throw invalidRequest(`The body is {"${field}": a positive integer}.`);
  }
  return value as number;
}

interface SummaryRow {
  revision: number;
  manifest: Manifest;
  published_at: Date;
  actor_user_id: string | null;
  restored_from: number | null;
  cloned_from: unknown;
  pinned: boolean;
}

const SUMMARY = `SELECT r.revision, r.manifest, r.published_at, r.actor_user_id, r.restored_from,
                        r.cloned_from, p.tenant_id IS NOT NULL AS pinned
                   FROM theming_revisions r
                   LEFT JOIN theming_pins p ON p.theme_revision = r.revision`;

/** RevisionSummary, and Revision with `manifest`. */
function revisionBody(row: SummaryRow, withManifest: boolean): Record<string, unknown> {
  return {
    revision: row.revision,
    name: row.manifest.name,
    mode: row.manifest.mode === "advanced" ? "advanced" : "simple",
    published_at: row.published_at.toISOString(),
    actor_user_id: row.actor_user_id,
    ...(row.restored_from === null ? {} : { restored_from: row.restored_from }),
    ...(row.cloned_from === null ? {} : { cloned_from: row.cloned_from }),
    pinned: row.pinned,
    ...(withManifest ? { manifest: row.manifest } : {}),
  };
}

async function oneRevision(c: SqlClient, revision: number): Promise<Record<string, unknown>> {
  const { rows } = await c.query(`${SUMMARY} WHERE r.revision = $1`, [revision]);
  const row = rows[0] as SummaryRow | undefined;
  if (row === undefined) throw notFound();
  return revisionBody(row, true);
}

export function revisionRoutes(app: FastifyInstance, deps: RevisionDeps): void {
  const writer = { preHandler: needs(deps.rights, WRITE) };

  /** Publish or restore: the revision, its audit entry, then (after commit) its event. */
  async function publish(
    request: FastifyRequest,
    /** What would be published, read without locks; undefined when there is nothing (404 follows). */
    sourceOf: (c: SqlClient) => Promise<{ source: string; manifest: Manifest } | undefined>,
    write: (
      c: SqlClient,
      base: Omit<PublishInput, "manifest" | "source" | "restoredFrom">,
    ) => Promise<Published>,
  ): Promise<Record<string, unknown>> {
    const actor = actorOf(request);
    // Whoever changes embeds needs the embeds right as well, also through a publish or restore.
    // Checked before any lock: the check may call admin, which must never hold up the event's history.
    const embedsAllowed = await deps.db.tenant(async (c) => {
      const s = await sourceOf(c);
      return s !== undefined && embedsDiffer(c, s.source, s.manifest);
    });
    if (embedsAllowed) await deps.rights.check(request.headers.cookie, EMBEDS);
    const zeroTokens = fillTokens((await deps.profile(requireTenant())) ?? {});
    const [published, body] = await deps.db.tenant(async (c) => {
      const p = await write(c, { actor, embedsAllowed, zeroTokens });
      // Appended before commit, so no revision exists unaudited. The reverse can happen: if the
      // commit then fails, the log holds an entry for a number the next publish takes again.
      const restored =
        p.restoredFrom === null ? {} : { restored_from: { old: null, new: p.restoredFrom } };
      await deps.audit({
        tenant_id: requireTenant(),
        actor_user_id: actor,
        action: p.restoredFrom === null ? "theming.theme.published" : "theming.theme.restored",
        target: { type: "theme_revision", id: String(p.revision) },
        changes: {
          revision: { old: p.previous, new: p.revision },
          ...restored,
          ...(p.embeds === undefined ? {} : { embeds: p.embeds }),
        },
      });
      return [p, await oneRevision(c, p.revision)] as const;
    });
    // After commit: a lost event must not turn a committed revision into an error the client
    // retries (it would meet no_draft or a conflict). Surfaces still catch up through `current`.
    await deps.bus
      .publish(
        "theming.theme.published",
        {
          revision: published.revision,
          restored_from: published.restoredFrom,
          cloned_from: null,
          changed: published.changed,
          tokens_css_url: published.tokensCss,
          css_url: null,
          embed_color: published.embedColor,
          actor_user_id: actor,
        },
        { version: 1 },
      )
      .catch((err: unknown) => {
        deps.log.error({ err, revision: published.revision }, "theming.theme.published not sent");
      });
    return body;
  }

  app.post("/api/theming/draft/publish", writer, async (request, reply) => {
    assertWritable(request);
    const version = bodyInt(request.body, "draft_version");
    try {
      const fromDraft = async (c: SqlClient) => {
        const draft = await loadDraft(c);
        return draft && { source: "draft", manifest: draft.manifest };
      };
      const body = await publish(request, fromDraft, async (c, base) => {
        const draft = await lockDraft(c, version);
        // Checked again: the stored problems may come from an older module version.
        const problems = checkManifest(draft.manifest);
        if (hasError(problems)) throw new Invalid(problems);
        const current = await lockHistory(c);
        const p = await writeRevision(c, deps.files, current, {
          ...base,
          manifest: draft.manifest,
          source: "draft",
          restoredFrom: null,
        });
        await removeDraft(c);
        return p;
      });
      return await reply.status(201).send(body);
    } catch (err) {
      if (!(err instanceof Invalid)) throw err;
      return reply.status(422).send({
        error: {
          code: "theme_invalid",
          message: "The draft has errors; fix them first.",
          problems: err.problems,
        },
      });
    }
  });

  app.post<{ Params: { revision: string } }>(
    "/api/theming/revisions/:revision/restore",
    writer,
    async (request, reply) => {
      assertWritable(request);
      const from = positiveInt(request.params.revision, "revision") as number;
      const expected = bodyInt(request.body, "current_revision");
      const fromRevision = async (c: SqlClient) => {
        const { rows } = await c.query(
          `SELECT manifest FROM theming_revisions WHERE revision = $1`,
          [from],
        );
        const row = rows[0] as { manifest: Manifest } | undefined;
        return row && { source: `r:${from}`, manifest: row.manifest };
      };
      const body = await publish(request, fromRevision, async (c, base) => {
        const current = await lockHistory(c);
        const source = await fromRevision(c);
        if (source === undefined) throw notFound();
        if (current !== expected) throw versionConflict("theme");
        return writeRevision(c, deps.files, current, {
          ...base,
          manifest: source.manifest,
          source: `r:${from}`,
          restoredFrom: from,
        });
      });
      return reply.status(201).send(body);
    },
  );

  app.get<{ Querystring: { before?: string; limit?: string } }>(
    "/api/theming/revisions",
    writer,
    async (request) => {
      const before = positiveInt(request.query.before, "before");
      const limit = positiveInt(request.query.limit, "limit") ?? 20;
      if (limit > 100) throw invalidRequest("limit is at most 100.");
      return deps.db.tenant(async (c) => {
        const { rows } = await c.query(
          `${SUMMARY} WHERE $1::integer IS NULL OR r.revision < $1 ORDER BY r.revision DESC LIMIT $2`,
          [before ?? null, limit],
        );
        return {
          current_revision: await currentRevision(c),
          revisions: (rows as unknown as SummaryRow[]).map((r) => revisionBody(r, false)),
        };
      });
    },
  );

  app.get<{ Params: { revision: string } }>(
    "/api/theming/revisions/:revision",
    writer,
    async (request) => {
      const revision = positiveInt(request.params.revision, "revision") as number;
      return deps.db.tenant((c) => oneRevision(c, revision));
    },
  );
}

/** A draft with errors: publish answers 422 with them, and the transaction writes nothing. */
class Invalid extends Error {
  constructor(readonly problems: unknown[]) {
    super("theme_invalid");
  }
}

export interface InternalDeps {
  db: Db;
  tenants: TenantResolver;
}

/** For the screen module's server, which draws a pinned revision (contracts/screen.md, Pins). */
export function internalRoutes(app: FastifyInstance, deps: InternalDeps): void {
  app.get<{ Params: { revision: string }; Querystring: { tenant_id?: string } }>(
    "/internal/theming/revisions/:revision",
    async (request) => {
      if (request.service !== "screen")
        throw new ServiceForbidden(`module ${String(request.service)} may not call this`);
      const revision = positiveInt(request.params.revision, "revision");
      const tenant = request.query.tenant_id;
      if (revision === undefined || tenant === undefined || !isTenantId(tenant)) {
        throw invalidRequest("A revision and a tenant_id are required.");
      }
      if ((await deps.tenants.byId(tenant)) === null) throw notFound();
      const theme = await withTenant(tenant, () =>
        deps.db.tenant((c) => resolvedRevision(c, revision)),
      );
      if (theme === undefined) throw notFound();
      return theme;
    },
  );
}
