/** Admin's `PATCH /internal/admin/settings/screen` as the harness fakes it (contracts/admin.md, Settings). */
import { AdminError } from "@canccu/kit";
import type { SettingValue } from "@canccu/kit";
import type { SettingsWrite } from "../src/motion-routes.js";

export interface SettingsWrites {
  /** tenant → its settings_version (0 until written). */
  versions: Record<string, number>;
  /** Every write admin took, in order. */
  log: { tenantId: string; actor: string; values: Record<string, unknown> }[];
}

export function fakeSettingsWrite(
  settings: Record<string, Record<string, SettingValue>>,
  writes: SettingsWrites,
): SettingsWrite {
  return (tenantId, write) => {
    const version = writes.versions[tenantId] ?? 0;
    if (write.settings_version !== version) {
      return Promise.reject(
        new AdminError("stale settings", { status: 409, code: "version_conflict" }),
      );
    }
    writes.versions[tenantId] = version + 1;
    settings[tenantId] = {
      ...settings[tenantId],
      ...(write.values as Record<string, SettingValue>),
    };
    writes.log.push({ tenantId, actor: write.actor_user_id, values: write.values });
    return Promise.resolve({ settings_version: version + 1, values: { ...settings[tenantId] } });
  };
}
