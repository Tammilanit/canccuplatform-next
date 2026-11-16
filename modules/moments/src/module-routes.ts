/**
 * The paths that are no event's own request: a module's moment request on the internal network,
 * and the superadmin's venue-wide emergency on the superadmin hostname (contracts/moments.md).
 */
import type { FastifyInstance } from "fastify";
import { KitError, isTenantId, withTenant } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { isClass } from "./arbiter.js";
import { invalid, qrOf, qrView, zonesOf } from "./content.js";
import { answerOf, send } from "./http.js";
import type { AppDeps } from "./http.js";
import { keyOf, once } from "./idempotency.js";
import type { Answer } from "./idempotency.js";
import { endEmergency, startEmergency } from "./routes.js";
import type { Binding, Source } from "./store.js";
import { noteTenant } from "./tick.js";

type Body = Record<string, unknown>;
const ROLES = ["full", "hero", "rail", "venue_rail", "ticker", "overlay"];

function seconds(v: unknown, field: string, min: number): number | undefined {
  if (v === undefined) return undefined;
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > 7200)
    throw invalid(`\`${field}\` is ${min} to 7200.`);
  return v as number;
}

function bindingOf(v: unknown): Binding | null {
  if (v === undefined || v === null) return null;
  const b = v as Body;
  if (b.source === "none" || b.source === "leaderboard") return { source: b.source };
  if (b.source === "session" && typeof b.ref === "string") return { source: "session", ref: b.ref };
  throw invalid("`binding` is none, leaderboard, or a session with its `ref`.");
}

function sourceOf(v: unknown, module: string): Source {
  const s = (v ?? {}) as Body;
  const opt = (x: unknown) => (typeof x === "string" ? x : null);
  return { module, event_id: opt(s.event_id), ref: opt(s.ref) };
}

export function internalRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post<{ Querystring: { tenant_id?: string } }>(
    "/internal/moments/moments",
    async (request, reply) => {
      const tenant = request.query.tenant_id ?? "";
      if (!isTenantId(tenant)) throw invalid("`tenant_id` names an event.");
      const ctx = await deps.tenants.byId(tenant);
      if (ctx === null) throw new KitError("No such event.", { status: 404, code: "not_found" });
      if (ctx.status === "archived")
        throw new KitError(undefined, { status: 409, code: "event_archived" });
      const b = (request.body ?? {}) as Body;
      if (!isClass(b.class) || b.class === "emergency")
        throw invalid("`class` names a class; never the emergency.");
      if (typeof b.template !== "string" || typeof b.content !== "object" || b.content === null) {
        throw invalid("`template` and `content` are required.");
      }
      if (
        b.regions !== undefined &&
        !(
          Array.isArray(b.regions) &&
          b.regions.length > 0 &&
          b.regions.every((r) => ROLES.includes(r as string))
        )
      ) {
        throw invalid("`regions` lists region roles.");
      }
      if (
        b.dedupe_key !== undefined &&
        (typeof b.dedupe_key !== "string" || b.dedupe_key.length > 200)
      ) {
        throw invalid("`dedupe_key` is text of at most 200 characters.");
      }
      const qr = qrOf(b.qr);
      const module = request.service ?? "module";
      const content = {
        ...(b.content as Body),
        ...(qr === null ? {} : { qr: qrView(ctx.primary_hostname ?? `${tenant}.invalid`, qr) }),
      };
      const answer = await withTenant(tenant, async () => {
        await noteTenant(deps.db, tenant);
        const out = await deps.db.tenant(async (c) =>
          answerOf(
            c,
            await deps.engine.request(
              c,
              {
                class: b.class as never,
                template: b.template as string,
                content,
                origin: "module",
                why: `module: ${module}`,
                zones: zonesOf(b.zones),
                ...(b.regions === undefined ? {} : { regions: b.regions as string[] }),
                ...(b.ttl_seconds === undefined
                  ? {}
                  : { ttl_seconds: seconds(b.ttl_seconds, "ttl_seconds", 1) as number }),
                ...(b.patience_seconds === undefined
                  ? {}
                  : {
                      patience_seconds: seconds(
                        b.patience_seconds,
                        "patience_seconds",
                        0,
                      ) as number,
                    }),
                qr,
                binding: bindingOf(b.binding),
                source: sourceOf(b.source, module),
                dedupe_key: (b.dedupe_key as string | undefined) ?? null,
              },
              deps.now(),
            ),
          ),
        );
        await deps.outbox.flush();
        return out;
      });
      return send(reply, answer);
    },
  );
}

/** The superadmin's emergency on every event at a venue that is not archived (U4 C). */
export function venueRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = async (
    request: { hostname: string; headers: Record<string, unknown>; body: unknown },
    act: (
      c: SqlClient,
      tenant: string,
      body: Body,
      actor: { user_id: string; name: string },
      now: Date,
    ) => Promise<Answer>,
  ) => {
    // Only on the superadmin hostname, where a session can be a superadmin's at all.
    if (
      deps.superadminHost === undefined ||
      request.hostname.split(":")[0] !== deps.superadminHost
    ) {
      throw new KitError(undefined, { status: 404, code: "not_found" });
    }
    const session = await deps.rights.requireSuperadmin(
      request.headers.cookie as string | undefined,
    );
    const key = keyOf(request.headers["idempotency-key"], request.body);
    const body = (request.body ?? {}) as Body;
    if (typeof body.venue_id !== "string" || body.venue_id === "")
      throw invalid("`venue_id` names the venue.");
    const known = await deps.db.global(async (c) => {
      const { rows } = await c.query(
        `SELECT tenant_id FROM moments_tenants WHERE archived_at IS NULL`,
        [],
      );
      return rows.map((r) => r.tenant_id as string);
    });
    const reached: string[] = [];
    const actor = { user_id: session.userId, name: session.userName };
    for (const tenant of known) {
      const ctx = await deps.tenants.byId(tenant);
      if (ctx === null || ctx.status === "archived" || ctx.venue?.id !== body.venue_id) continue;
      const answer = await withTenant(tenant, async () => {
        const now = deps.now();
        const out = await deps.db.tenant((c) =>
          once(c, actor.user_id, key, now, () => act(c, tenant, body, actor, now)),
        );
        await deps.outbox.flush();
        return out;
      });
      if (answer.status < 400) reached.push(tenant);
    }
    if (reached.length === 0)
      throw new KitError("No event at that venue answered.", { status: 404, code: "not_found" });
    return { tenant_ids: reached };
  };
  const why = (name: string) => `Superadmin ${name} · venue emergency`;
  app.post("/api/moments/venue-emergency", (request) =>
    run(request, (c, tenant, body, actor, now) =>
      startEmergency(c, deps, tenant, body, actor, why(actor.name), now),
    ),
  );
  app.post("/api/moments/venue-emergency/end", (request) =>
    run(request, (c, tenant, body, actor, now) =>
      endEmergency(c, deps, tenant, body.all_clear === true, actor, why(actor.name), now),
    ),
  );
}
