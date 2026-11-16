/** The moments API: the running moments and the crew's actions (contracts/moments.md). */
import type { FastifyInstance } from "fastify";
import { requireRight } from "@canccu/kit/fastify";
import type { SqlClient } from "@canccu/kit";
import { allClearRequest, emergencyRequest, invalid, spotlightRequest } from "./content.js";
import type { Engine } from "./engine.js";
import {
  EMERGENCY,
  READ,
  TAKE,
  answerOf,
  crewAction,
  failure,
  momentViews,
  notRunning,
  tenantOf,
} from "./http.js";
import type { AppDeps } from "./http.js";
import type { Answer } from "./idempotency.js";
import type { Audit } from "./audit.js";
import { knownZones, lockMoment, runningMoments, titleOf } from "./store.js";
import type { Actor } from "./store.js";

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (typeof b === "object" && b !== null ? (b as Body) : {});

/** Starts the event's emergency; one runs at a time (E10, mockup 07). */
export async function startEmergency(
  c: SqlClient,
  deps: { engine: Engine; audit: Audit },
  tenant: string,
  body: Body,
  actor: Actor,
  why: string,
  now: Date,
): Promise<Answer> {
  // One per event: the lock makes two concurrent starts take turns, so the second sees the first.
  await c.query(
    `SELECT pg_advisory_xact_lock(hashtext('moments.emergency:' || current_setting('canccu.tenant', true)))`,
  );
  const running = await runningMoments(c, "class = 'emergency'");
  if (running.length > 0) return failure(409, "emergency_active", "An emergency already runs.");
  const r = await deps.engine.request(c, emergencyRequest(body, actor, why, now), now);
  if (r.status !== "refused") {
    await deps.audit({
      tenant_id: tenant,
      actor_user_id: actor.user_id,
      action: "moments.emergency.started",
      target: { type: "moment", id: r.moment.id },
    });
  }
  return answerOf(c, r);
}

/** Ends it everywhere with one tap; "All clear" takes the rail for 60 s when asked. */
export async function endEmergency(
  c: SqlClient,
  deps: { engine: Engine; audit: Audit },
  tenant: string,
  allClear: boolean,
  actor: Actor,
  why: string,
  now: Date,
): Promise<Answer> {
  const [m] = await runningMoments(c, "class = 'emergency'", [], "wait");
  if (m === undefined) return failure(404, "not_found", "No emergency runs.");
  await deps.engine.end(c, m, "cleared", actor, now);
  if (allClear) await deps.engine.request(c, allClearRequest(actor, why, m.zones, now), now);
  await deps.audit({
    tenant_id: tenant,
    actor_user_id: actor.user_id,
    action: "moments.emergency.ended",
    target: { type: "moment", id: m.id },
    changes: { all_clear: { old: null, new: allClear } },
  });
  return { status: 200, body: (await momentViews(c, [m]))[0] };
}

export function momentRoutes(app: FastifyInstance, deps: AppDeps): void {
  const read = { preHandler: requireRight(deps.rights, READ) };
  const take = { preHandler: requireRight(deps.rights, TAKE) };
  const emergency = { preHandler: requireRight(deps.rights, EMERGENCY) };

  app.get("/api/moments/moments", read, async () =>
    deps.db.tenant(async (c) => {
      const running = await runningMoments(c);
      const views = await momentViews(c, running);
      views.sort((a, b) => (b.rank as number) - (a.rank as number));
      return { moments: views, zones: await knownZones(c) };
    }),
  );

  app.post<{ Params: { moment_id: string } }>(
    "/api/moments/moments/:moment_id/end",
    take,
    (request, reply) =>
      crewAction(deps, request, reply, async (c, actor, now) => {
        const body = bodyOf(request.body);
        const zone = body.zone_key;
        if (zone !== undefined && (typeof zone !== "string" || !/^[a-z0-9_-]{2,32}$/.test(zone))) {
          throw invalid("`zone_key` is a zone key.");
        }
        const m = await lockMoment(c, request.params.moment_id);
        if (m === null) return failure(404, "not_found", "No such moment.");
        if (m.ended_at !== null) throw notRunning();
        // U12: an emergency ends only through Emergency; a rule's moment ends one zone at a time.
        if (m.class === "emergency") throw invalid("An emergency ends through Emergency.");
        if (zone === undefined && m.origin !== "crew") {
          throw invalid("A rule's moment ends on one zone at a time (End in zone).");
        }
        await deps.engine.end(c, m, "cleared", actor, now, zone);
        await deps.audit({
          tenant_id: tenantOf(request).tenant_id,
          actor_user_id: actor.user_id,
          action: "moments.moment.ended",
          target: { type: "moment", id: m.id },
          changes: {
            zone_key: { old: null, new: zone ?? null },
            title: { old: titleOf(m), new: null },
          },
        });
        return { status: 200, body: (await momentViews(c, [m]))[0] };
      }),
  );

  app.post<{ Params: { moment_id: string } }>(
    "/api/moments/moments/:moment_id/extend",
    take,
    (request, reply) =>
      crewAction(deps, request, reply, async (c, actor, now) => {
        const seconds = bodyOf(request.body).seconds;
        if (!Number.isInteger(seconds) || (seconds as number) < 1 || (seconds as number) > 3600) {
          throw invalid("`seconds` is 1 to 3600.");
        }
        const m = await lockMoment(c, request.params.moment_id);
        if (m === null) return failure(404, "not_found", "No such moment.");
        if (m.ended_at !== null) throw notRunning();
        if (m.expires_at === null) throw invalid("An emergency has no end to move.");
        const before = m.expires_at.toISOString();
        await deps.engine.extend(c, m, seconds as number, actor, now);
        await deps.audit({
          tenant_id: tenantOf(request).tenant_id,
          actor_user_id: actor.user_id,
          action: "moments.moment.extended",
          target: { type: "moment", id: m.id },
          changes: { expires_at: { old: before, new: m.expires_at.toISOString() } },
        });
        return { status: 200, body: (await momentViews(c, [m]))[0] };
      }),
  );

  app.post("/api/moments/spotlight", take, (request, reply) =>
    crewAction(deps, request, reply, async (c, actor, now) => {
      const ctx = tenantOf(request);
      const req = await spotlightRequest(
        c,
        bodyOf(request.body),
        actor,
        ctx.primary_hostname ?? request.hostname,
        now,
      );
      const r = await deps.engine.request(c, req, now);
      if (r.status !== "refused") {
        await deps.audit({
          tenant_id: ctx.tenant_id,
          actor_user_id: actor.user_id,
          action: "moments.spotlight.started",
          target: { type: "moment", id: r.moment.id },
          changes: {
            template: { old: null, new: req.template },
            zones: { old: null, new: req.zones },
          },
        });
      }
      return answerOf(c, r);
    }),
  );

  app.post("/api/moments/emergency", emergency, (request, reply) =>
    crewAction(deps, request, reply, (c, actor, now) =>
      startEmergency(
        c,
        deps,
        tenantOf(request).tenant_id,
        bodyOf(request.body),
        actor,
        `${actor.name} · emergency`,
        now,
      ),
    ),
  );

  app.post("/api/moments/emergency/end", emergency, (request, reply) =>
    crewAction(deps, request, reply, (c, actor, now) =>
      endEmergency(
        c,
        deps,
        tenantOf(request).tenant_id,
        bodyOf(request.body).all_clear === true,
        actor,
        `${actor.name} · emergency`,
        now,
      ),
    ),
  );
}
