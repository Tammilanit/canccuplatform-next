/**
 * Settings client (contracts/admin.md, Settings): per tenant, read on admin's internal path and
 * followed through admin.settings.changed. It does not write: a write is a person's, made on
 * admin's API on the event's own hostname, which is how admin knows the tenant; a module on
 * admin's internal address could name none.
 */
import { AdminClient } from "./admin.js";
import type { Event } from "./bus.js";
import type { ServiceIdentity } from "./service.js";
import { isTenantId, requireTenant, withTenant } from "./tenant.js";

export type Scalar = string | number | boolean;
export type SettingValue = Scalar | Scalar[];

interface SettingsBody {
  settings_version: number;
  values: Record<string, SettingValue>;
}

interface Held {
  version: number;
  values: Record<string, SettingValue>;
}

export interface SettingsClientOptions {
  /** Signs the internal read (audience `admin`); admin's internal paths take no session. */
  service: ServiceIdentity;
  /** Runs inside the changed tenant's scope. */
  onChange?: (keys: string[]) => Promise<void> | void;
}

export class SettingsClient {
  /** tenant → its settings; only tenants this container has served are held. */
  private readonly held = new Map<string, Held>();
  /** tenant → its first load in flight, so concurrent first requests ask admin once. */
  private readonly loading = new Map<string, Promise<void>>();

  constructor(
    private readonly admin: AdminClient,
    readonly module: string,
    private readonly options: SettingsClientOptions,
  ) {}

  private store(tenant: string, body: unknown): void {
    const b = body as SettingsBody;
    this.held.set(tenant, { version: b.settings_version, values: { ...b.values } });
  }

  /** Read `tenant`'s settings (default: the current tenant). */
  async load(tenant: string = requireTenant()): Promise<void> {
    // The id goes into the query of an internal path: never pass one that is not an id.
    if (!isTenantId(tenant)) throw new RangeError(`invalid tenant id ${JSON.stringify(tenant)}`);
    const response = await this.admin.request("GET", `/internal/admin/settings/${this.module}`, {
      headers: this.options.service.headers("admin"),
      params: { tenant_id: tenant },
    });
    AdminClient.raiseForError(response);
    this.store(tenant, response.body);
  }

  /** Load the current tenant's settings unless they are held; concurrent callers share one read. */
  async ensure(): Promise<void> {
    const tenant = requireTenant();
    if (this.held.has(tenant)) return;
    let pending = this.loading.get(tenant);
    if (pending === undefined) {
      pending = this.load(tenant).finally(() => this.loading.delete(tenant));
      this.loading.set(tenant, pending);
    }
    await pending;
  }

  /** The current tenant's value, or `fallback` when it has none (or was not loaded). */
  get(key: string, fallback: SettingValue): SettingValue;
  get(key: string): SettingValue | undefined;
  get(key: string, fallback?: SettingValue): SettingValue | undefined {
    return this.held.get(requireTenant())?.values[key] ?? fallback;
  }

  /** The current tenant's settings_version; 0 when not loaded. */
  get settingsVersion(): number {
    return this.held.get(requireTenant())?.version ?? 0;
  }

  /**
   * Feed tenant events from `admin`. Re-reads a held tenant on a newer change for this module; a
   * tenant not held has nothing to refresh, and its first load() reads the current settings.
   */
  async handleEvent(event: Event): Promise<void> {
    if (event.type !== "admin.settings.changed" || event.data.module !== this.module) return;
    const tenant = event.tenant;
    if (tenant === undefined) return;
    const held = this.held.get(tenant);
    if (held === undefined) return;
    const newVersion = event.data.settings_version;
    if (typeof newVersion === "number" && newVersion <= held.version) return;
    await this.load(tenant);
    const keys = event.data.keys;
    const changed = Array.isArray(keys)
      ? keys.filter((k): k is string => typeof k === "string")
      : [];
    await withTenant(tenant, async () => {
      await this.options.onChange?.(changed);
    });
  }
}
