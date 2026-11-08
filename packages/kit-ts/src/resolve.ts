/**
 * Host → tenant (0013 item 2, contracts/tenants.md, Resolving the tenant). The tenant comes only
 * from the request's hostname, through the tenants API; a module never reads the registry itself.
 */
import { isIP } from "node:net";
import type { TenantContext } from "./access.js";
import type { Event } from "./bus.js";
import { ConfigError } from "./config.js";
import { KitError } from "./errors.js";
import type { ServiceIdentity } from "./service.js";
import { isTenantId } from "./tenant.js";

/** The tenant the IP-mode demo stack serves. */
export const DEMO_TENANT = "demo";
export const RESOLVE_CACHE_MS = 30_000;
/** The Host header is the client's: without a bound, random hosts would grow the cache forever. */
export const RESOLVE_CACHE_MAX = 10_000;

/** An unknown host gets 404 with no detail, so it learns nothing about the registry. */
export class UnknownHost extends KitError {
  static override defaultStatus = 404;
  static override defaultCode = "not_found";
  constructor() {
    super("Not found.");
  }
}

export class TenantsUnavailable extends KitError {
  static override defaultStatus = 503;
  static override defaultCode = "tenants_unavailable";
}

export type Resolution =
  | { kind: "tenant"; context: TenantContext }
  /** The central sign-in host or the superadmin hostname: outside tenant resolution. */
  | { kind: "platform"; host: string };

/** Lowercase, without the port or a trailing dot; `undefined` for an empty host. */
export function normalizeHost(host: string | null | undefined): string | undefined {
  let h = (host ?? "").trim().toLowerCase();
  if (h.startsWith("[")) h = h.slice(1, h.indexOf("]") === -1 ? undefined : h.indexOf("]"));
  else if (isIP(h) !== 6) h = h.replace(/:\d*$/, "");
  h = h.replace(/\.$/, "");
  return h === "" ? undefined : h;
}

export interface IpMode {
  /** The platform version; IP mode runs only while it is `dev` (0013 item 2). */
  version: string;
  /**
   * The demo tenant's context, or null when IP mode must not serve. Without it the resolver asks
   * `GET /internal/tenants/ip-mode`, so every module runs IP mode the same way. The kit refuses
   * anything but the demo tenant whatever the answer.
   */
  load?: () => Promise<TenantContext | null>;
}

export interface TenantResolverOptions {
  /** The tenants module's internal base URL, e.g. `http://tenants:8000`. */
  tenantsUrl: string;
  /** The platform's own hostnames (sign-in, superadmin); never resolved to a tenant. */
  platformHosts?: string[];
  /** Only the CI demo stack sets this. */
  ipMode?: IpMode;
  /** Signs every call to `/internal/tenants/*` (audience `tenants`). */
  service?: ServiceIdentity;
  fetch?: typeof fetch;
  cacheMs?: number;
  maxEntries?: number;
  now?: () => number;
}

type Cached = { at: number; context: TenantContext | null };

export class TenantResolver {
  private readonly tenantsUrl: string;
  private readonly platformHosts: Set<string>;
  private readonly fetch: typeof fetch;
  private readonly cacheMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, Cached>();

  constructor(private readonly options: TenantResolverOptions) {
    if (options.ipMode !== undefined && options.ipMode.version !== "dev") {
      throw new ConfigError("IP mode runs only while the platform version is dev");
    }
    this.tenantsUrl = options.tenantsUrl.replace(/\/+$/, "");
    this.platformHosts = new Set(
      (options.platformHosts ?? []).map(normalizeHost).filter((h): h is string => h !== undefined),
    );
    this.fetch = options.fetch ?? globalThis.fetch;
    this.cacheMs = options.cacheMs ?? RESOLVE_CACHE_MS;
    this.maxEntries = options.maxEntries ?? RESOLVE_CACHE_MAX;
    this.now = options.now ?? Date.now;
  }

  async resolve(rawHost: string | null | undefined): Promise<Resolution> {
    const host = normalizeHost(rawHost);
    if (host === undefined) throw new UnknownHost();
    if (this.platformHosts.has(host)) return { kind: "platform", host };
    const hit = this.cache.get(host);
    let context: TenantContext | null;
    if (hit !== undefined && this.now() - hit.at < this.cacheMs) {
      context = hit.context;
    } else {
      this.cache.delete(host);
      context = isIP(host) === 0 ? await this.lookup(host) : await this.ipModeContext();
      this.remember(host, context);
    }
    if (context === null) throw new UnknownHost();
    return { kind: "tenant", context };
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  /** A Map iterates in insertion order, so the first key is the oldest entry. */
  private remember(host: string, context: TenantContext | null): void {
    this.cache.delete(host);
    this.cache.set(host, { at: this.now(), context });
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private async ipModeContext(): Promise<TenantContext | null> {
    const ipMode = this.options.ipMode;
    if (ipMode === undefined) return null;
    const context = ipMode.load
      ? await ipMode.load()
      : await this.ask("/internal/tenants/ip-mode", [404]);
    return context?.tenant_id === DEMO_TENANT ? context : null;
  }

  private lookup(host: string): Promise<TenantContext | null> {
    // 400 too: a host the tenants module cannot even parse is unknown, not an outage.
    return this.ask(`/internal/tenants/resolve?host=${encodeURIComponent(host)}`, [404, 400]);
  }

  /** The context the tenants module answers on `path`, or null on one of `none` statuses. */
  private async ask(path: string, none: number[]): Promise<TenantContext | null> {
    let response: Response;
    try {
      response = await this.fetch(`${this.tenantsUrl}${path}`, {
        headers: this.options.service?.headers("tenants") ?? {},
      });
    } catch (err) {
      throw new TenantsUnavailable(`tenants module unreachable: ${String(err)}`);
    }
    if (none.includes(response.status)) return null;
    if (!response.ok) throw new TenantsUnavailable(`tenants module answered ${response.status}`);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TenantsUnavailable("tenants module answered with something that is not JSON");
    }
    // The id goes into keys, streams and paths: never trust it unchecked.
    const id = (body as { tenant_id?: unknown } | null)?.tenant_id;
    if (typeof id !== "string" || !isTenantId(id)) {
      throw new TenantsUnavailable("tenants module answered without a valid tenant id");
    }
    return body as TenantContext;
  }

  /**
   * Feed every tenants event here: a tenant event drops that tenant, a platform event all. Any
   * tenants event also drops unknown hosts, so a hostname just added resolves at once.
   */
  handleEvent(event: Event): void {
    if (event.source !== "tenants") return;
    if (event.tenant === undefined) {
      this.cache.clear();
      return;
    }
    for (const [host, cached] of this.cache) {
      if (cached.context === null || cached.context.tenant_id === event.tenant) {
        this.cache.delete(host);
      }
    }
  }
}
