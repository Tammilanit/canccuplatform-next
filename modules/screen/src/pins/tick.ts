/**
 * The end of a timed pin (contracts/screen.md, Timed pins and freeze): every second, in every
 * container, each event with a pin is checked once (a Valkey claim per event and second), and a
 * pin past its `until` gives way to `restores`, or to no pin when what it names is gone. Events
 * come from `screen_pin_tenants`, so an event with no screen paired is restored on time too.
 */
import { isTenantId, requireTenant, tenantKey, withTenant } from "@canccu/kit";
import type { Bus, Logger, TenantContext } from "@canccu/kit";
import type { Audit } from "../audit.js";
import type { Sources } from "../compose/sources.js";
import type { Db } from "../db.js";
import type { Kv } from "../kv.js";
import type { Fanout } from "../push/store.js";
import { publishAll } from "../zones.js";
import type { BundleStore } from "./bundles.js";
import { changePin, lockPin, readPin } from "./store.js";
import type { PinRow, PinValues } from "./store.js";

/** Shorter than a tick, so the next second's check is free to any container. */
const CLAIM_MS = 900;

export interface PinTickDeps {
  db: Db;
  kv: Kv;
  bus: Bus;
  audit: Audit;
  sources: Pick<Sources, "theme" | "themeRevision">;
  bundles: Pick<BundleStore, "available">;
  fanout: Pick<Fanout, "publish">;
  tenantById: (id: string) => Promise<TenantContext | null>;
  now: () => number;
  log?: Logger;
}

const sameEnd = (a: PinRow, b: PinRow) =>
  a.until?.getTime() === b.until?.getTime() &&
  JSON.stringify(a.restores) === JSON.stringify(b.restores);

/** What the restore puts back: `restores`, or nothing when its bundle or revision is gone; undefined to wait. */
async function restoreOf(deps: PinTickDeps, restores: PinValues): Promise<PinValues | undefined> {
  const none = { bundle_version: null, theme_revision: null };
  const bundle = restores.bundle_version;
  if (bundle !== null && !(await deps.bundles.available()).includes(bundle)) return none;
  const theme = restores.theme_revision;
  if (theme !== null && (await deps.sources.themeRevision(requireTenant(), theme)) === null) {
    // Theming down says nothing about the revision: the next second asks again.
    if ((await deps.sources.theme(requireTenant())) === null) return undefined;
    return none;
  }
  return restores;
}

/** Restores the current tenant's pin when its `until` has come. */
export async function expirePin(deps: PinTickDeps): Promise<void> {
  const nowMs = deps.now();
  const seen = await deps.db.tenant(readPin);
  if (seen.until === null || seen.restores === null || seen.until.getTime() > nowMs) return;
  const back = await restoreOf(deps, seen.restores);
  if (back === undefined) return;
  const emit = await deps.db.tenant(async (c) => {
    const before = await lockPin(c);
    // A person may have changed the pin since it was read: then that change stands.
    if (!sameEnd(before, seen)) return null;
    const next: PinRow = {
      ...back,
      until: null,
      restores: null,
      changed_by: null,
      changed_by_name: null,
      changed_at: new Date(nowMs),
    };
    return changePin(deps, c, before, next, "expired", nowMs);
  });
  if (emit !== null) await publishAll(deps.bus, [emit]);
}

export function pinTickRunner(deps: PinTickDeps): () => Promise<void> {
  return async () => {
    const tenants = await deps.db.global(async (c) =>
      (await c.query("SELECT tenant_id FROM screen_pin_tenants")).rows.map(
        (r) => r.tenant_id as string,
      ),
    );
    for (const tenant of tenants.filter(isTenantId)) {
      try {
        const ctx = await deps.tenantById(tenant);
        // An archived event is read-only: its pin stays as it was.
        if (ctx === null || ctx.status === "archived") continue;
        await withTenant(tenant, async () => {
          if (await deps.kv.setIfAbsent(tenantKey("screen", "pin", "tick"), "1", CLAIM_MS)) {
            await expirePin(deps);
          }
        });
      } catch (err) {
        // One event's failure never holds back the others' pins.
        deps.log?.warn({ err, tenant_id: tenant }, "screen pin tick failed");
      }
    }
  };
}
