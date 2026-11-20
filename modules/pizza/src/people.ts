/**
 * Who a user is to the bus: the Person shape's Discord id comes from the tenants module at emit
 * time (contracts/events.md, People in events), and whether they are a member of the event.
 */
import type { ServiceIdentity } from "@canccu/kit";

export type People = (userId: string) => Promise<{ discord_user_id: string | null }>;
export type Members = (tenant: string, userId: string) => Promise<boolean>;

const TTL_MS = 5 * 60_000;
const MAX = 5000;

/**
 * `GET /internal/tenants/users/{user_id}`, cached a few minutes. A Discord id the emitter does not
 * know is `null` (E13), so a tenants module that does not answer never stops an order.
 */
export function tenantsPeople(
  tenantsUrl: string,
  service: ServiceIdentity,
  fetchFn: typeof fetch = fetch,
): People {
  const cache = new Map<string, { until: number; id: string | null }>();
  const base = tenantsUrl.replace(/\/+$/, "");
  return async (userId) => {
    const hit = cache.get(userId);
    if (hit !== undefined && hit.until > Date.now()) return { discord_user_id: hit.id };
    let id: string | null = null;
    try {
      const r = await fetchFn(`${base}/internal/tenants/users/${encodeURIComponent(userId)}`, {
        headers: service.headers("tenants"),
        signal: AbortSignal.timeout(2000),
      });
      if (r.ok) {
        const body = (await r.json()) as { discord_user_id?: unknown };
        id = typeof body.discord_user_id === "string" ? body.discord_user_id : null;
      }
    } catch {
      id = null;
    }
    if (cache.size >= MAX) cache.clear();
    cache.set(userId, { until: Date.now() + TTL_MS, id });
    return { discord_user_id: id };
  };
}

/**
 * Until the tenants module serves membership (#150), every signed-in session on the event's
 * hostname counts as a member: sessions are bound to one event (agenda and notify do the same).
 * This is the one place to change when `GET /internal/tenants/tenants/{id}/users/{user}` answers.
 */
export const everySessionIsMember: Members = () => Promise.resolve(true);
