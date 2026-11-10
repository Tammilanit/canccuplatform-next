/** A storage quota held in memory, as tenants holds it (contracts/tenants.md, Storage quota). */
import { KitError, requireTenant } from "@canccu/kit";
import type { StorageQuota } from "@canccu/kit";

export interface FakeQuota {
  /** Bytes per tenant, and the limit each gets (default 2 GiB). */
  storage: { used: Record<string, number>; quota: Record<string, number> };
  quota: StorageQuota;
}

export function fakeQuota(): FakeQuota {
  const storage = { used: {} as Record<string, number>, quota: {} as Record<string, number> };
  const quota: StorageQuota = {
    module: "theming",
    reserve: (bytes) => {
      const tenant = requireTenant();
      const used = (storage.used[tenant] ?? 0) + bytes;
      if (used > (storage.quota[tenant] ?? 2 ** 31)) {
        return Promise.reject(
          new KitError("This event's files would pass its storage quota.", {
            status: 413,
            code: "storage_quota_exceeded",
          }),
        );
      }
      storage.used[tenant] = used;
      return Promise.resolve();
    },
    release: (bytes) => {
      const tenant = requireTenant();
      storage.used[tenant] = Math.max(0, (storage.used[tenant] ?? 0) - bytes);
      return Promise.resolve();
    },
    repair: (bytes) => {
      storage.used[requireTenant()] = bytes;
      return Promise.resolve();
    },
  };
  return { storage, quota };
}
