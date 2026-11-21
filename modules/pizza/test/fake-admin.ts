/** A fake of admin's settings API, as the Food settings page calls it as the person. */
import type { AppDeps } from "../src/http.js";

/** Admin's settings API for the Food settings page: one event's pizza settings, versioned. */
export interface AdminSettings {
  values: Record<string, unknown>;
  version: number;
  writes: { host: string; values: Record<string, unknown> }[];
  /** Admin's status for a read instead of the settings, e.g. 404 or 503. */
  readStatus?: number;
}

export function fakeAdminSettings(
  store: AdminSettings,
  rightsOf: (session: string) => string[],
): AppDeps["admin"] {
  return {
    request: (method, path, o = {}) => {
      const id = (o.headers?.cookie ?? "").replace("canccu_session=", "");
      const rights = rightsOf(id);
      const status = (code: number, body: unknown) => Promise.resolve({ status: code, body });
      if (path !== "/api/admin/settings/pizza") return status(404, {});
      if (!rights.includes(method === "GET" ? "admin.settings.read" : "admin.settings.write"))
        return status(403, { error: { code: "missing_right", message: "needs a right" } });
      if (method === "GET" && store.readStatus !== undefined)
        return status(store.readStatus, { error: { code: "not_found", message: "no" } });
      if (method === "PUT") {
        const b = o.json as { settings_version: number; values: Record<string, unknown> };
        if (b.settings_version !== store.version)
          return status(409, { error: { code: "version_conflict", message: "stale" } });
        store.values = b.values;
        store.version += 1;
        store.writes.push({ host: o.headers?.host ?? "", values: b.values });
      }
      return status(200, {
        module: "pizza",
        values: store.values,
        settings_version: store.version,
        groups: [],
      });
    },
  };
}
