/**
 * Rights check through GET /api/admin/session, cached for at most 30 s (contracts/admin.md).
 *
 * A command in Discord acts for its person with an acting token (contracts/admin.md, The acting
 * token): `fromHeaders` takes it only beside the bot's service identity, which a browser cannot
 * make, so a token copied out of a log opens nothing on its own.
 */
import { type AdminResponse, AdminClient } from "./admin.js";
import type { Event } from "./bus.js";
import { MissingRight, NotSignedIn } from "./errors.js";
import { SERVICE_HEADER, type ServiceIdentity } from "./service.js";
import { currentTenant } from "./tenant.js";

export const SESSION_COOKIE = "canccu_session";
export const CACHE_MS = 30_000;
export const ACTING_HEADER = "x-canccu-acting";
/** The only module that may bring an acting token: the bot gains no rights of its own (D2). */
const ACTING_CALLER = "bot";

/** A request's header by its lower-case name. */
export type HeaderOf = (name: string) => string | null | undefined;

export interface Session {
  userId: string;
  userName: string;
  rights: ReadonlySet<string>;
  expiresAt: Date;
  /** contracts/admin.md, Session and rights: only `true` from admin counts; anything else is false. */
  superadmin: boolean;
}

/** The canccu_session value from a Cookie header, or undefined. */
export function sessionIdFromCookie(cookieHeader: string | undefined | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, "");
    if (name === SESSION_COOKIE && value !== "") return value;
  }
  return undefined;
}

interface SessionBody {
  user: { id: string; name: string };
  rights: string[];
  expires_at: string;
  superadmin?: unknown;
}

export class RightsChecker {
  private readonly cache = new Map<string, { until: number; session: Session }>();
  private readonly byUser = new Map<string, Set<string>>();
  private readonly now: () => number;
  /** This module's own identity: checks the bot's header and signs the call to admin. */
  private readonly service: ServiceIdentity | undefined;

  constructor(
    private readonly admin: AdminClient,
    options: { now?: () => number; service?: ServiceIdentity } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.service = options.service;
  }

  private cached(sessionId: string): Session | undefined {
    const entry = this.cache.get(sessionId);
    if (entry === undefined) return undefined;
    if (this.now() >= entry.until) {
      this.forget(sessionId);
      return undefined;
    }
    return entry.session;
  }

  private remember(sessionId: string, session: Session): void {
    const now = this.now();
    const ttl = Math.min(CACHE_MS, session.expiresAt.getTime() - now);
    if (ttl <= 0) return;
    this.cache.set(sessionId, { until: now + ttl, session });
    const ids = this.byUser.get(session.userId) ?? new Set<string>();
    ids.add(sessionId);
    this.byUser.set(session.userId, ids);
  }

  private forget(sessionId: string): void {
    const entry = this.cache.get(sessionId);
    if (entry === undefined) return;
    this.cache.delete(sessionId);
    const ids = this.byUser.get(entry.session.userId);
    ids?.delete(sessionId);
    if (ids?.size === 0) this.byUser.delete(entry.session.userId);
  }

  /** The signed-in session; throws NotSignedIn or AdminUnavailable. */
  async session(cookieHeader: string | undefined | null): Promise<Session> {
    const sessionId = sessionIdFromCookie(cookieHeader);
    if (sessionId === undefined) throw new NotSignedIn("sign in first");
    const cached = this.cached(sessionId);
    if (cached !== undefined) return cached;
    const response = await this.admin.request("GET", "/api/admin/session", { sessionId });
    const session = parse(response);
    this.remember(sessionId, session);
    return session;
  }

  /**
   * The person an acting token stands for, in the tenant in scope; throws ServiceUnauthenticated
   * or ServiceForbidden when the bot did not send it, NotSignedIn for a token admin refuses. Never
   * cached: a token lives a minute and names one module.
   */
  async acting(serviceHeader: string | null | undefined, token: string): Promise<Session> {
    const tenant = currentTenant();
    if (this.service === undefined || tenant === undefined) throw new NotSignedIn("sign in first");
    this.service.require(serviceHeader, [ACTING_CALLER]);
    const response = await this.admin.request("GET", "/internal/admin/acting-session", {
      params: { tenant_id: tenant },
      headers: { ...this.service.headers("admin"), [ACTING_HEADER]: token },
    });
    return parse(response);
  }

  /** The session a request stands for: its acting token when it carries one, else its cookie's. */
  async fromHeaders(header: HeaderOf): Promise<Session> {
    const token = header(ACTING_HEADER);
    if (token !== null && token !== undefined) return this.acting(header(SERVICE_HEADER), token);
    return this.session(header("cookie"));
  }

  async checkHeaders(header: HeaderOf, right: string): Promise<Session> {
    const session = await this.fromHeaders(header);
    if (!session.rights.has(right)) throw new MissingRight(`needs right ${right}`);
    return session;
  }

  /** The session if it holds `right`; throws NotSignedIn, MissingRight or AdminUnavailable. */
  async check(cookieHeader: string | undefined | null, right: string): Promise<Session> {
    const session = await this.session(cookieHeader);
    if (!session.rights.has(right)) throw new MissingRight(`needs right ${right}`);
    return session;
  }

  /**
   * The session if admin says it is the superadmin's; throws NotSignedIn, MissingRight or
   * AdminUnavailable. The caller still answers its superadmin paths only on the superadmin
   * hostname (contracts/admin.md).
   */
  async requireSuperadmin(cookieHeader: string | undefined | null): Promise<Session> {
    const session = await this.session(cookieHeader);
    if (!session.superadmin) throw new MissingRight("superadmins only");
    return session;
  }

  /** Feed events from `events:admin`; drops the user's cached sessions on a rights change. */
  handleEvent(event: Event): void {
    if (event.type !== "admin.rights.changed") return;
    const userId = event.data.user_id;
    if (typeof userId !== "string") return;
    for (const sessionId of [...(this.byUser.get(userId) ?? [])]) this.forget(sessionId);
  }
}

function parse(response: AdminResponse): Session {
  if (response.status === 401) throw new NotSignedIn("sign in first");
  AdminClient.raiseForError(response);
  const body = response.body as SessionBody;
  return {
    userId: body.user.id,
    userName: body.user.name,
    rights: new Set(body.rights.map(String)),
    expiresAt: new Date(body.expires_at),
    superadmin: body.superadmin === true,
  };
}
