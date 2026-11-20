/** What the routes share: the app's dependencies, who the caller is, and the write wrapper. */
import { KitError, NotSignedIn, checkAdminAccess, checkInfoAccess } from "@canccu/kit";
import type {
  AdminClient,
  Health,
  Logger,
  Outbox,
  RightsChecker,
  Session,
  SqlClient,
  TenantContext,
  TenantResolver,
} from "@canccu/kit";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Audit } from "./audit.js";
import type { Db } from "./db.js";
import type { Step } from "./lifecycle.js";
import type { LiveHub } from "./live.js";
import { keyOf, once } from "./idempotency.js";
import type { Answer } from "./idempotency.js";
import type { Members, People } from "./people.js";
import { MANAGE } from "./policy.js";
import type { Caller } from "./policy.js";
import type { PizzaSettings } from "./settings.js";
import type { Actor } from "./store.js";
import { dayTurn, eventDay } from "./time.js";
import { InvalidBody } from "./validate.js";

export interface AppDeps {
  db: Db;
  /** Admin's API, for the Food settings page, which saves through it as the person. */
  admin: Pick<AdminClient, "request">;
  /** The event's language (admin's own `language` setting): `en` or `fi`. */
  language: (tenant: string) => Promise<string>;
  outbox: Outbox;
  rights: RightsChecker;
  tenants: TenantResolver;
  audit: Audit;
  health: Health;
  log: Logger;
  now: () => Date;
  members: Members;
  people: People;
  settings: (tenant: string) => Promise<PizzaSettings>;
  /** The pages' live streams open on this container (live.ts). */
  live: LiveHub;
}

export const tenantOf = (request: FastifyRequest): TenantContext => {
  const t = request.tenant;
  if (t === null) throw new KitError("no event", { status: 404, code: "not_found" });
  return t;
};

export const notFound = (what = "order"): KitError =>
  new KitError(`No such ${what}.`, { status: 404, code: "not_found" });

export interface Who {
  session: Session | null;
  caller: Caller | null;
}

/** The caller, if signed in: a member or not, and whether crew rights count from where they are. */
export async function whoIs(deps: AppDeps, request: FastifyRequest): Promise<Who> {
  const ctx = tenantOf(request);
  let session: Session | null = null;
  try {
    session = await deps.rights.session(request.headers.cookie);
  } catch (err) {
    if (!(err instanceof NotSignedIn)) throw err;
  }
  if (session === null) return { session, caller: null };
  await noteCrew(deps, ctx.tenant_id, session);
  let restricted = false;
  try {
    checkAdminAccess(ctx, request.ip);
  } catch {
    restricted = true;
  }
  return {
    session,
    caller: {
      user_id: session.userId,
      member: await deps.members(ctx.tenant_id, session.userId),
      rights: session.rights,
      restricted,
    },
  };
}

const CREW_SEEN_MS = 5 * 60_000;
const crewSeen = new WeakMap<AppDeps, Map<string, { crew: boolean; until: number }>>();

/**
 * The scheduler's crew (pizza_crew): who showed `pizza.order.manage` here when last seen. No module
 * answers who holds a right, so pizza notes it from the sessions it serves, at most every few
 * minutes per person, and forgets someone whose session no longer has it.
 */
async function noteCrew(deps: AppDeps, tenant: string, session: Session): Promise<void> {
  const crew = session.rights.has(MANAGE);
  let seen = crewSeen.get(deps);
  if (seen === undefined)
    crewSeen.set(deps, (seen = new Map<string, { crew: boolean; until: number }>()));
  const key = `${tenant} ${session.userId}`;
  const hit = seen.get(key);
  const now = deps.now();
  if (hit !== undefined && hit.crew === crew && hit.until > Date.now()) return;
  await deps.db.tenant((c) =>
    crew
      ? c.query(
          `INSERT INTO pizza_crew (user_id, seen_at) VALUES ($1, $2)
           ON CONFLICT (tenant_id, user_id) DO UPDATE SET seen_at = EXCLUDED.seen_at`,
          [session.userId, now],
        )
      : c.query(`DELETE FROM pizza_crew WHERE user_id = $1`, [session.userId]),
  );
  if (seen.size > 5000) seen.clear();
  seen.set(key, { crew, until: Date.now() + CREW_SEEN_MS });
}

/** A guest's read, or a non-member's, follows the event's info-page mode (U15). */
export function guestRead(request: FastifyRequest, caller: Caller | null): void {
  if (caller?.member === true) return;
  checkInfoAccess(tenantOf(request), { clientIp: request.ip, viewer: "guest" });
}

export const actorOf = (s: Session): Actor => ({ user_id: s.userId, name: s.userName });

export function today(ctx: TenantContext, now: Date): string {
  return eventDay(now, ctx.time_zone);
}

/** The holder keeps the money until the order's event day turns at 06:00 (the plan, Money). */
export const holderMoneyOpen = (ctx: TenantContext, day: string, now: Date): boolean =>
  now.getTime() < dayTurn(day, ctx.time_zone).getTime();

export const eventArchived = (): KitError =>
  new KitError("The event is archived: food is read-only.", {
    status: 409,
    code: "event_archived",
  });

/** The body as an object, or 400: Fastify parses JSON but checks no shape. */
export function body(request: FastifyRequest): Record<string, unknown> {
  const value: unknown = request.body ?? {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidBody("body", "must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export interface WriteCtx extends Who {
  session: Session;
  caller: Caller;
  ctx: TenantContext;
  step: (c: SqlClient) => Step;
  now: Date;
}

/**
 * A person's write: signed in, the event not archived, its `Idempotency-Key` making a retry harmless
 * (E2), all of it in one tenant transaction with its audit entries; its events go out once it has
 * committed (E12).
 */
export async function write(
  deps: AppDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  run: (c: SqlClient, w: WriteCtx) => Promise<Answer>,
): Promise<FastifyReply> {
  const ctx = tenantOf(request);
  const who = await whoIs(deps, request);
  if (who.session === null || who.caller === null) throw new NotSignedIn("sign in first");
  if (ctx.status === "archived") throw eventArchived();
  const key = keyOf(request.headers["idempotency-key"]);
  const now = deps.now();
  const session = who.session;
  const caller = who.caller;
  const w: WriteCtx = {
    session,
    caller,
    ctx,
    now,
    step: (c) => ({ c, e: deps, now, actor: actorOf(session) }),
  };
  const answer = await deps.db.tenant((c) => once(c, session.userId, key, now, () => run(c, w)));
  await deps.outbox.flush();
  if (answer.status === 204) return reply.status(204).send();
  return reply.status(answer.status).send(answer.body);
}

export const ok = (body: unknown, status = 200): Answer => ({ status, body });
