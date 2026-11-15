/**
 * The end of a timed pin (contracts/screen.md, Timed pins and freeze): every second, in every
 * container, each event with a pin is checked once (a Valkey claim per event and second), and a
 * pin past its `until` gives way to `restores`, or to no pin when what it names is gone. Events
 * come from `screen_pin_tenants`, so an event with no screen paired is restored on time too.
 */
import { isTenantId, tenantKey, withTenant } from "@canccu/kit";
import type { Logger, Outbox, TenantContext } from "@canccu/kit";
import type { Audit } from "../audit.js";
import type { Sources } from "../compose/sources.js";
import type { Db } from "../db.js";
import type { Kv } from "../kv.js";
import type { Fanout } from "../push/store.js";
import type { BundleStore } from "./bundles.js";
import { announcePin, changePin, lockPin, readPin, restoreOf, sameEnd } from "./store.js";
import type { PinRow } from "./store.js";

/** Shorter than a tick, so the next second's check is free to any container. */
const CLAIM_MS = 900;

export interface PinTickDeps {
  db: Db;
  kv: Kv;
  outbox: Outbox;
  audit: Audit;
  sources: Pick<Sources, "themeRevision">;
  bundles: Pick<BundleStore, "available">;
  fanout: Pick<Fanout, "publish">;
  tenantById: (id: string) => Promise<TenantContext | null>;
  now: () => number;
  log?: Logger;
}

/** Restores the current tenant's pin when its `until` has come. */
export async function expirePin(deps: PinTickDeps): Promise<void> {
  const nowMs = deps.now();
  const seen = await deps.db.tenant(readPin);
  if (seen.until === null || seen.restores === null || seen.until.getTime() > nowMs) return;
  const back = await restoreOf(deps, seen.restores);
  // Theming could not say whether the revision exists: the next second asks again.
  if (back === undefined) return;
  const change = await deps.db.tenant(async (c) => {
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
    return changePin(deps, c, before, next, "expired");
  });
  if (change !== null) await announcePin(deps, change, nowMs);
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
