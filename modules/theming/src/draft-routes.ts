/** The draft's API: start, read, discard, tokens and layouts (contracts/theming.openapi.yaml, draft). */
import type { FastifyInstance } from "fastify";
import { requireTenant } from "@canccu/kit";
import type { RightsChecker } from "@canccu/kit";
import type { ProfileSource } from "./profile.js";
import type { Manifest } from "./checks.js";
import type { Db } from "./db.js";
import { createDraft, draftBody, editDraft, loadDraft, lockDraft, removeDraft } from "./drafts.js";
import type { DraftSource } from "./drafts.js";
import {
  WRITE,
  actorOf,
  assertWritable,
  invalidRequest,
  needs,
  noDraft,
  notFound,
  positiveInt,
} from "./http.js";
import { draftFileNames } from "./package-files.js";
import { layoutError, tokensEditError } from "./schema.js";
import type { TokensEdit } from "./schema.js";
import { writingFiles } from "./stored.js";
import type { StoredDeps } from "./stored.js";

export interface DraftDeps extends StoredDeps {
  db: Db;
  rights: RightsChecker;
  profile: ProfileSource;
}

function draftSource(body: unknown): DraftSource {
  const b = (body ?? {}) as Record<string, unknown>;
  const keys = Object.keys(b);
  if (keys.some((k) => k !== "from" && k !== "revision")) throw invalidRequest("Unknown field.");
  if (b.from === "defaults" || b.from === "current") {
    if (b.revision !== undefined) throw invalidRequest("revision goes only with from: revision.");
    return { from: b.from };
  }
  if (b.from === "revision" && Number.isInteger(b.revision) && (b.revision as number) >= 1) {
    return { from: "revision", revision: b.revision as number };
  }
  throw invalidRequest("from is current, defaults, or revision with a revision.");
}

/** `null` removes a token (back to the default); a group left empty is dropped. */
function mergeTokens(manifest: Manifest, edit: TokensEdit["tokens"]): Manifest {
  const tokens = (manifest.tokens ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = {};
  for (const group of ["colors", "fonts", "sizes"] as const) {
    const values = Object.entries({ ...(tokens[group] ?? {}), ...edit[group] }).filter(
      ([, v]) => v !== null,
    );
    if (values.length > 0) merged[group] = Object.fromEntries(values);
  }
  const motion = edit.motion === undefined ? tokens.motion : edit.motion;
  if (motion !== undefined && motion !== null) merged.motion = motion;
  // `null` resets the whole style; a field set to null goes back to its default.
  const style = Object.entries(
    edit.motion_style === null
      ? {}
      : { ...(tokens.motion_style as Record<string, unknown> | undefined), ...edit.motion_style },
  ).filter(([, v]) => v !== null);
  if (style.length > 0) merged.motion_style = Object.fromEntries(style);
  // Setting any token but motion and motion_style is styling, which makes the theme advanced (contracts/theming.md,
  // Advanced mode); removing one only goes back towards what the simple mode generates.
  const styling = (["colors", "fonts", "sizes"] as const).some((g) =>
    Object.values(edit[g] ?? {}).some((v) => v !== null),
  );
  return { ...manifest, tokens: merged, ...(styling ? { mode: "advanced" } : {}) };
}

function layoutsOf(manifest: Manifest): Record<string, unknown>[] {
  return Array.isArray(manifest.layouts) ? (manifest.layouts as Record<string, unknown>[]) : [];
}

export function draftRoutes(app: FastifyInstance, deps: DraftDeps): void {
  const writer = { preHandler: needs(deps.rights, WRITE) };

  app.get("/api/theming/draft", writer, async () => {
    const row = await deps.db.tenant((c) => loadDraft(c));
    if (row === undefined) throw noDraft();
    return draftBody(row);
  });

  app.post("/api/theming/draft", writer, async (request, reply) => {
    assertWritable(request);
    const source = draftSource(request.body);
    const profile = source.from === "current" ? await deps.profile(requireTenant()) : undefined;
    const row = await deps.db.tenant((c) => createDraft(c, source, actorOf(request), profile));
    return reply.status(201).send(draftBody(row));
  });

  app.delete<{ Querystring: { draft_version?: string } }>(
    "/api/theming/draft",
    writer,
    async (request, reply) => {
      assertWritable(request);
      const version = requiredVersion(request.query.draft_version);
      await writingFiles(deps, async (c) => {
        await lockDraft(c, version);
        const unused = await draftFileNames(c);
        await removeDraft(c);
        return { result: undefined, unused };
      });
      return reply.status(204).send();
    },
  );

  app.patch("/api/theming/draft/tokens", writer, async (request) => {
    assertWritable(request);
    const why = tokensEditError(request.body);
    if (why !== undefined) throw invalidRequest(why);
    const edit = request.body as TokensEdit;
    const row = await deps.db.tenant((c) =>
      editDraft(c, edit.draft_version, actorOf(request), (m) => mergeTokens(m, edit.tokens)),
    );
    return draftBody(row);
  });

  app.put<{ Params: { id: string }; Querystring: { draft_version?: string } }>(
    "/api/theming/draft/layouts/:id",
    writer,
    async (request) => {
      assertWritable(request);
      const version = requiredVersion(request.query.draft_version);
      const why = layoutError(request.body);
      if (why !== undefined) throw invalidRequest(why);
      const layout = request.body as Record<string, unknown>;
      if (layout.id !== request.params.id)
        throw invalidRequest("The layout's id must equal the path's.");
      const row = await deps.db.tenant((c) =>
        editDraft(c, version, actorOf(request), (m) => {
          const layouts = layoutsOf(m);
          const at = layouts.findIndex((l) => l.id === layout.id);
          return { ...m, layouts: at < 0 ? [...layouts, layout] : layouts.with(at, layout) };
        }),
      );
      return draftBody(row);
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { draft_version?: string } }>(
    "/api/theming/draft/layouts/:id",
    writer,
    async (request) => {
      assertWritable(request);
      const version = requiredVersion(request.query.draft_version);
      const row = await deps.db.tenant((c) =>
        editDraft(c, version, actorOf(request), (m) => {
          const layouts = layoutsOf(m);
          if (!layouts.some((l) => l.id === request.params.id)) throw notFound();
          return { ...m, layouts: layouts.filter((l) => l.id !== request.params.id) };
        }),
      );
      return draftBody(row);
    },
  );
}

export function requiredVersion(value: string | undefined): number {
  const version = positiveInt(value, "draft_version");
  if (version === undefined) throw invalidRequest("draft_version is required.");
  return version;
}
