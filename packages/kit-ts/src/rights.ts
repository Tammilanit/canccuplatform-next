/** Rights check through GET /api/admin/session, cached for at most 30 s (contracts/admin.md). */
import { AdminClient } from "./admin.js";
import type { Event } from "./bus.js";
import { MissingRight, NotSignedIn } from "./errors.js";

export const SESSION_COOKIE = "canccu_session";
export const CACHE_MS = 30_000;

export interface Session {
  userId: string;
  userName: string;
  rights: ReadonlySet<string>;
  expiresAt: Date;
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
}

export class RightsChecker {
  private readonly cache = new Map<string, { until: number; session: Session }>();
  private readonly byUser = new Map<string, Set<string>>();
  private readonly now: () => number;

  constructor(
    private readonly admin: AdminClient,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
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
    if (response.status === 401) throw new NotSignedIn("sign in first");
    AdminClient.raiseForError(response);
    const body = response.body as SessionBody;
    const session: Session = {
      userId: body.user.id,
      userName: body.user.name,
      rights: new Set(body.rights.map(String)),
      expiresAt: new Date(body.expires_at),
    };
    this.remember(sessionId, session);
    return session;
  }

  /** The session if it holds `right`; throws NotSignedIn, MissingRight or AdminUnavailable. */
  async check(cookieHeader: string | undefined | null, right: string): Promise<Session> {
    const session = await this.session(cookieHeader);
    if (!session.rights.has(right)) throw new MissingRight(`needs right ${right}`);
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
