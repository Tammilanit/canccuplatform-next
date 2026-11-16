/** The scenes API (contracts/moments.md, Scenes): the list, reset, and the crew button. */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { requireRight } from "@canccu/kit/fastify";
import { invalid } from "./content.js";
import {
  READ,
  SCENES_TAKE,
  SETTINGS,
  actorOf,
  archivedError,
  crewAction,
  failure,
  tenantOf,
} from "./http.js";
import type { AppDeps } from "./http.js";
import { PRESETS, checkScenes, crewMinutes, scenesOf } from "./scenes.js";
import type { Scene } from "./scenes.js";
import {
  crewView,
  evaluateScenes,
  loadCrew,
  loadScenes,
  pressCrew,
  sceneZones,
  writeScenes,
} from "./scene-store.js";
import { lockSettings } from "./store.js";

type Body = Record<string, unknown>;
const ZONE = /^[a-z0-9_-]{2,32}$/;

export async function scenesView(c: SqlClient, now: Date): Promise<Body> {
  const list = await loadScenes(c);
  const crew = await loadCrew(c);
  return {
    scenes: list.scenes,
    revision: list.revision,
    copied: list.copied,
    zones: await sceneZones(c),
    crew: crew !== null && crew.until > now ? crewView(crew) : null,
  };
}

export function sceneRoutes(app: FastifyInstance, deps: AppDeps): void {
  const read = { preHandler: requireRight(deps.rights, READ) };
  const write = { preHandler: requireRight(deps.rights, SETTINGS) };

  /** Replaces the list at `revision` and puts every zone in its scene at once; audited. */
  const replace = async (
    request: FastifyRequest,
    scenes: Scene[],
    revision: unknown,
    action: string,
  ): Promise<Body> => {
    const ctx = tenantOf(request);
    if (ctx.status === "archived") throw archivedError();
    const actor = actorOf(request.session);
    const now = deps.now();
    const out = await deps.db.tenant(async (c) => {
      await lockSettings(c, "scenes");
      // Before writeScenes locks the list's row: a scene pass holds "scene-zones" and then
      // reads that row, so the other order deadlocks a save against the pass.
      await lockSettings(c, "scene-zones");
      const before = await loadScenes(c);
      if (revision !== before.revision)
        throw new KitError("Someone saved meanwhile: read it again.", {
          status: 409,
          code: "version_conflict",
        });
      await writeScenes(c, scenes, before.revision + 1);
      await deps.audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actor.user_id,
        action,
        target: { type: "scenes", id: ctx.tenant_id },
        changes: { scenes: { old: before.scenes, new: scenes } },
      });
      await evaluateScenes(c, deps.engine.outbox, {
        timeZone: ctx.time_zone,
        now,
        actor: actor.user_id,
      });
      return scenesView(c, now);
    });
    await deps.outbox.flush();
    return out;
  };

  app.get("/api/moments/scenes", read, () => deps.db.tenant((c) => scenesView(c, deps.now())));
  app.put("/api/moments/scenes", write, (request) => {
    const body = (request.body ?? {}) as Body;
    const why = checkScenes(body.scenes);
    if (why !== null) throw invalid(why);
    return replace(
      request,
      scenesOf(body.scenes as Scene[]),
      body.revision,
      "moments.scenes.changed",
    );
  });
  app.post("/api/moments/scenes/reset", write, (request) => {
    const body = (request.body ?? {}) as Body;
    return replace(request, [...PRESETS], body.revision, "moments.scenes.reset");
  });

  // U11: one tap, no confirmation; a second press takes it off (E7). Idempotent, audited.
  app.post<{ Params: { scene_key: string } }>(
    "/api/moments/scenes/:scene_key/take",
    { preHandler: requireRight(deps.rights, SCENES_TAKE) },
    (request, reply) =>
      crewAction(deps, request, reply, async (c, actor, now) => {
        const zones = ((request.body ?? {}) as Body).zones ?? [];
        if (!Array.isArray(zones) || !zones.every((z) => typeof z === "string" && ZONE.test(z)))
          throw invalid("`zones` lists zone keys.");
        const scene = (await loadScenes(c)).scenes.find((s) => s.key === request.params.scene_key);
        if (scene === undefined) return failure(404, "not_found", "No such scene.");
        if (crewMinutes(scene) === null)
          return failure(400, "invalid_request", "That scene has no crew button.");
        const crew = await pressCrew(c, scene, zones as string[], actor.user_id, now);
        await deps.audit({
          tenant_id: tenantOf(request).tenant_id,
          actor_user_id: actor.user_id,
          action: crew === null ? "moments.scene.released" : "moments.scene.taken",
          target: { type: "scene", id: scene.key },
          changes: {
            until: { old: null, new: crew?.until.toISOString() ?? null },
            zones: { old: null, new: zones },
          },
        });
        await evaluateScenes(c, deps.engine.outbox, {
          timeZone: tenantOf(request).time_zone,
          now,
          actor: actor.user_id,
        });
        return { status: 200, body: await scenesView(c, now) };
      }),
  );
}
