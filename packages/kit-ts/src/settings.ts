/** Settings client: read at start, follow admin.settings.changed, write with settings_version. */
import { AdminClient } from "./admin.js";
import type { Event } from "./bus.js";
import { VersionConflict } from "./errors.js";

export type Scalar = string | number | boolean;
export type SettingValue = Scalar | Scalar[];

interface SettingsBody {
  settings_version: number;
  values: Record<string, SettingValue>;
}

export class SettingsClient {
  settingsVersion = 0;
  values: Record<string, SettingValue> = {};

  constructor(
    private readonly admin: AdminClient,
    readonly module: string,
    private readonly options: {
      sessionId?: string;
      onChange?: (keys: string[]) => Promise<void> | void;
    } = {},
  ) {}

  private get path(): string {
    return `/api/admin/settings/${this.module}`;
  }

  private apply(body: unknown): void {
    const b = body as SettingsBody;
    this.settingsVersion = b.settings_version;
    this.values = { ...b.values };
  }

  /** Read the settings once; call at module start. */
  async start(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const response = await this.admin.request("GET", this.path, {
      sessionId: this.options.sessionId,
    });
    AdminClient.raiseForError(response);
    this.apply(response.body);
  }

  get(key: string, fallback: SettingValue): SettingValue {
    return this.values[key] ?? fallback;
  }

  /** Replace the values; throws VersionConflict if they changed since they were read. */
  async write(
    values: Record<string, SettingValue>,
    options: { sessionId?: string } = {},
  ): Promise<void> {
    const response = await this.admin.request("PUT", this.path, {
      sessionId: options.sessionId ?? this.options.sessionId,
      json: { settings_version: this.settingsVersion, values },
    });
    if (response.status === 409) {
      throw new VersionConflict("settings changed since they were read; read again and retry");
    }
    AdminClient.raiseForError(response);
    this.apply(response.body);
  }

  /** Feed events from `events:admin`; re-reads on a newer change for this module. */
  async handleEvent(event: Event): Promise<void> {
    if (event.type !== "admin.settings.changed" || event.data.module !== this.module) return;
    const newVersion = event.data.settings_version;
    if (typeof newVersion === "number" && newVersion <= this.settingsVersion) return;
    await this.refresh();
    const keys = event.data.keys;
    const changed = Array.isArray(keys)
      ? keys.filter((k): k is string => typeof k === "string")
      : [];
    await this.options.onChange?.(changed);
  }
}
