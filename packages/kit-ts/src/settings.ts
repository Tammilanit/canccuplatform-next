/**
 * Settings client (contracts/admin.md, Settings): per tenant, read on admin's internal path,
 * followed through admin.settings.changed, written with settings_version.
 */
import { AdminClient } from "./admin.js";
import type { Event } from "./bus.js";
import { VersionConflict } from "./errors.js";
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
  /** The session for write() when the call gives none. */
  sessionId?: string;
  /** Runs inside the changed tenant's scope. */
  onChange?: (keys: string[]) => Promise<void> | void;
}

export class SettingsClient {
  /** tenant → its settings; only tenants this container has served are held. */
  private readonly held = new Map<string, Held>();

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

  /** Read the current tenant's settings; the name modules used before settings were per tenant. */
  start(): Promise<void> {
    return this.load();
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
   * Replace the current tenant's values as a person (their session needs `admin.settings.write`);
   * throws VersionConflict if they changed since they were read.
   */
  async write(
    values: Record<string, SettingValue>,
    options: { sessionId?: string } = {},
  ): Promise<void> {
    const tenant = requireTenant();
    const response = await this.admin.request("PUT", `/api/admin/settings/${this.module}`, {
      sessionId: options.sessionId ?? this.options.sessionId,
      json: { settings_version: this.held.get(tenant)?.version ?? 0, values },
    });
    if (response.status === 409) {
      throw new VersionConflict("settings changed since they were read; read again and retry");
    }
    AdminClient.raiseForError(response);
    this.store(tenant, response.body);
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
