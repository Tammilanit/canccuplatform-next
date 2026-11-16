/** What the routes share: the app's dependencies, the crew action wrapper and the API's views. */
import { KitError } from "@canccu/kit";
import type {
  Health,
  Logger,
  Outbox,
  RightsChecker,
  ServiceIdentity,
  Session,
  SqlClient,
  TenantContext,
  TenantResolver,
} from "@canccu/kit";
import type { FastifyReply, FastifyRequest } from "fastify";
import { rankOf } from "./arbiter.js";
import type { Audit } from "./audit.js";
import type { Cues } from "./cues/service.js";
import type { ScreenClient } from "./cues/screen.js";
import type { Db } from "./db.js";
import type { Engine, RequestResult } from "./engine.js";
import { once } from "./idempotency.js";
import type { Answer } from "./idempotency.js";
import { keyOf } from "./idempotency.js";
import type { AgendaReader } from "./scene-store.js";
import { loadOrders } from "./store.js";
import type { Actor, MomentRow } from "./store.js";

export const READ = "moments.read";
export const TAKE = "moments.take";
export const EMERGENCY = "moments.emergency";
export const SCENES_TAKE = "moments.scenes.take";
export const SETTINGS = "moments.settings.write";

export interface AppDeps {
  db: Db;
  engine: Engine;
  cues: Cues;
  screen: ScreenClient;
  outbox: Outbox;
  rights: RightsChecker;
  tenants: TenantResolver;
  audit: Audit;
  service: ServiceIdentity;
  health: Health;
  log: Logger;
  now: () => Date;
  /** The event's agenda, for the scenes' agenda conditions; none in most tests. */
  agenda?: AgendaReader;
  /** The superadmin's hostname: the venue-wide emergency answers only there. */
  superadminHost: string | undefined;
}

export const tenantOf = (request: FastifyRequest): TenantContext => {
  const t = request.tenant;
  if (t === null) throw new KitError("no event", { status: 404, code: "not_found" });
  return t;
};

export const actorOf = (session: Session | null | undefined): Actor => {
  if (session === null || session === undefined)
    throw new KitError(undefined, { status: 401, code: "not_signed_in" });
  return { user_id: session.userId, name: session.userName };
};

export const archivedError = (): KitError =>
  new KitError("The event is archived: Moments is read-only.", {
    status: 409,
    code: "event_archived",
  });

export const notRunning = (): KitError =>
  new KitError("That moment has ended.", { status: 409, code: "not_running" });

/** 409 `moment_refused`, with when to ask again and who holds the regions. */
export class Refused extends KitError {
  constructor(
    readonly retryAfter: number,
    readonly heldBy: string | null,
  ) {
    super("Every region it may take is held by a higher rank.", {
      status: 409,
      code: "moment_refused",
    });
  }
  override toBody() {
    const body = super.toBody();
    return { error: { ...body.error, retry_after_seconds: this.retryAfter, held_by: this.heldBy } };
  }
}

/** An answer of a request: 201 started, 200 renewed; a refusal is thrown after the commit. */
export async function answerOf(c: SqlClient, r: RequestResult): Promise<Answer> {
  if (r.status === "refused") {
    return {
      status: 409,
      body: { refused: true, retry_after_seconds: r.retry_after_seconds, held_by: r.held_by },
    };
  }
  return {
    status: r.status === "started" ? 201 : 200,
    body: (await momentViews(c, [r.moment]))[0],
  };
}

/**
 * A crew action: archived events refuse it, its key makes a retry harmless (E18), and it runs in
 * one tenant transaction with its audit entry; its events go out once it has committed.
 */
export async function crewAction(
  deps: AppDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  run: (c: SqlClient, actor: Actor, now: Date) => Promise<Answer>,
): Promise<FastifyReply> {
  if (tenantOf(request).status === "archived") throw archivedError();
  const actor = actorOf(request.session);
  const key = keyOf(request.headers["idempotency-key"], request.body);
  const now = deps.now();
  const answer = await deps.db.tenant((c) =>
    once(c, actor.user_id, key, now, () => run(c, actor, now)),
  );
  await deps.outbox.flush();
  return send(reply, answer);
}

export function send(reply: FastifyReply, answer: Answer): FastifyReply {
  const b = answer.body as {
    refused?: boolean;
    retry_after_seconds: number;
    held_by: string | null;
  };
  if (answer.status === 409 && b.refused === true)
    throw new Refused(b.retry_after_seconds, b.held_by);
  if (answer.status >= 400) {
    const e = (answer.body as { error: { code: string; message: string } }).error;
    throw new KitError(e.message, { status: answer.status, code: e.code });
  }
  return reply.status(answer.status).send(answer.body);
}

/** Errors a crew action answers the same way to a retry: stored like an answer. */
export const failure = (status: number, code: string, message: string): Answer => ({
  status,
  body: { error: { code, message } },
});

/** The API's `Moment`: the row, its rank in the event's order, and where Screen placed it. */
export async function momentViews(
  c: SqlClient,
  moments: MomentRow[],
): Promise<Record<string, unknown>[]> {
  if (moments.length === 0) return [];
  const orders = await loadOrders(c);
  const { rows } = await c.query(
    `SELECT moment_id, zone_key, state, role, since FROM moment_placements
     WHERE moment_id = ANY($1::text[]) ORDER BY zone_key`,
    [moments.map((m) => m.id)],
  );
  return moments.map((m) => ({
    id: m.id,
    class: m.class,
    rank: rankOf(orders.order, m.class),
    kind: m.kind,
    regions: m.regions,
    template: m.template,
    content: m.content,
    zones: m.zones,
    origin: m.origin,
    rule_id: m.rule_id,
    source: m.source,
    actor: m.actor_user_id === null ? null : { user_id: m.actor_user_id, name: m.actor_name ?? "" },
    starts_at: m.starts_at.toISOString(),
    expires_at: m.expires_at?.toISOString() ?? null,
    patience_seconds: m.patience_seconds,
    qr: m.qr,
    binding: m.binding,
    placements: rows
      .filter((p) => p.moment_id === m.id)
      .map((p) => ({
        zone_key: p.zone_key,
        state: p.state,
        role: p.role,
        since: (p.since as Date).toISOString(),
      })),
    ended_at: m.ended_at?.toISOString() ?? null,
    end_reason: m.end_reason,
  }));
}
