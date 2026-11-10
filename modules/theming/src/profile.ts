/** Where the event profile's `theme` comes from (contracts/theming.md; contracts/admin.md, For theming). */
import type { ServiceIdentity } from "@canccu/kit";
import type { PartialTokens } from "./tokens.js";

/** The profile's `theme` of one event, or undefined when it sets none. */
export type ProfileSource = (tenant: string) => Promise<PartialTokens | undefined>;

/**
 * Re-read at least this often, in case an `admin.profile.loaded` was missed (the kit's bus has no
 * consumer groups yet, so an event that arrives while Valkey blips is gone).
 */
const MAX_AGE_MS = 60_000;
const RETRY_MS = 10_000;

export interface AdminProfile {
  read: ProfileSource;
  /** Feed admin's tenant events here: `admin.profile.loaded` drops that event's copy. */
  handleEvent(event: { type: string; tenant?: string }): void;
}

/**
 * Admin's `GET /internal/admin/profile/theme`, kept per event in memory: every revision 0 read and
 * every served revision 0 file asks for it. While admin cannot answer, the last answer stays in use
 * (so revision 0's file names do not change under pages already loaded), or the platform defaults
 * without one, and admin is asked again only after RETRY_MS, so reads do not each wait for it.
 *
 * The profile's `logo_main` is not read yet: theming may store a logo only through the image
 * checks and the storage quota of the uploads slice (#242).
 */
export function adminProfile(
  adminUrl: string,
  service: ServiceIdentity,
  opts: { fetch?: typeof fetch; now?: () => number } = {},
): AdminProfile {
  const fetchFn = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const base = adminUrl.replace(/\/+$/, "");
  const kept = new Map<string, { theme: PartialTokens | undefined; at: number }>();

  async function ask(tenant: string): Promise<{ theme: PartialTokens | undefined } | undefined> {
    try {
      const response = await fetchFn(
        `${base}/internal/admin/profile/theme?tenant_id=${encodeURIComponent(tenant)}`,
        { headers: service.headers("admin"), signal: AbortSignal.timeout(2000) },
      );
      if (response.status === 404) return { theme: undefined };
      if (!response.ok) return undefined;
      const body = (await response.json()) as { theme?: unknown };
      const theme = body.theme;
      const empty = typeof theme !== "object" || theme === null || Object.keys(theme).length === 0;
      return { theme: empty ? undefined : theme };
    } catch {
      return undefined;
    }
  }

  return {
    async read(tenant) {
      const hit = kept.get(tenant);
      if (hit !== undefined && now() - hit.at < MAX_AGE_MS) return hit.theme;
      const answer = await ask(tenant);
      if (answer === undefined) {
        const theme = hit?.theme;
        kept.set(tenant, { theme, at: now() - MAX_AGE_MS + RETRY_MS });
        return theme;
      }
      kept.set(tenant, { theme: answer.theme, at: now() });
      return answer.theme;
    },
    handleEvent(event) {
      if (event.type === "admin.profile.loaded" && event.tenant !== undefined) {
        kept.delete(event.tenant);
      }
    },
  };
}
