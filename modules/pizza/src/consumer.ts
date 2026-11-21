/**
 * What pizza consumes (contracts/pizza.md, Consumes): the tenants module's lifecycle, retention,
 * membership and clone. Events come at least once and to every container, so each handler is
 * idempotent: a second run finds nothing left to do.
 */
import { withTenant } from "@canccu/kit";
import type { Event } from "@canccu/kit";
import { asTenant, noteTenant } from "./db.js";
import type { AppDeps } from "./http.js";
import { cancel } from "./lifecycle.js";
import { UNPLACED } from "./model.js";
import { anonymiseAll, deleteTenantRows, forgetUser, leave } from "./privacy.js";
import { deleteReceiptFiles } from "./receipts.js";
import { menuEntries, ordersWhere } from "./store.js";

type Deps = Pick<AppDeps, "db" | "outbox" | "people" | "now" | "filesRoot">;

const TENANT_ID = /^[a-z][a-z0-9-]{2,31}$/;

/** A tenants event of one event, run inside its tenant (the kit's subscribeTenants sets it). */
export async function handleTenantEvent(deps: Deps, e: Event): Promise<void> {
  if (e.tenant === undefined || e.source !== "tenants") return;
  const now = deps.now();
  const userId = typeof e.data.user_id === "string" ? e.data.user_id : null;
  if (e.type === "tenants.status.changed" && e.data.to === "archived") {
    // E11: what is not called in yet will not be; called-in orders stay for the record.
    await deps.db.tenant(async (c) => {
      for (const o of await ordersWhere(c, `state = ANY($1::text[])`, [UNPLACED])) {
        await cancel({ c, e: deps, now, actor: null }, o.id, UNPLACED, "cancelled", null);
      }
    });
  } else if (e.type === "tenants.retention.reached" && e.data.data_class === "personal") {
    // `presence` is not a class pizza holds; a class it does not know is ignored.
    await deps.db.tenant((c) => anonymiseAll(c));
    await deleteReceiptFiles(deps.filesRoot);
  } else if (e.type === "tenants.member.left" && userId !== null) {
    await deps.db.tenant((c) => leave(c, deps, userId, now));
  } else if (e.type === "tenants.tenant.cloned") {
    const source = e.data.source_tenant_id;
    if (typeof source === "string" && TENANT_ID.test(source) && source !== e.tenant) {
      await cloneFrom(deps, source, e.tenant);
    }
    return;
  } else return;
  await deps.outbox.flush();
}

/** A platform event of the tenants module (no tenant): a deleted user, a deleted event. */
export async function handlePlatformEvent(deps: Deps, e: Event): Promise<void> {
  if (e.source !== "tenants") return;
  if (e.type === "tenants.user.deleted" && typeof e.data.user_id === "string") {
    const userId = e.data.user_id;
    const { rows } = await deps.db.global((c) =>
      c.query(`SELECT tenant_id FROM pizza_tenants`, []),
    );
    for (const { tenant_id } of rows as { tenant_id: string }[]) {
      await withTenant(tenant_id, async () => {
        await deps.db.tenant((c) => forgetUser(c, deps, userId, deps.now()));
        await deps.outbox.flush();
      });
    }
  } else if (e.type === "tenants.tenant.deleted" && typeof e.data.tenant_id === "string") {
    const tenant = e.data.tenant_id;
    await deps.db.global(async (c) => {
      await asTenant(c, tenant);
      await deleteTenantRows(c);
      await c.query(`DELETE FROM pizza_tenants WHERE tenant_id = $1`, [tenant]);
      await c.query(`DELETE FROM pizza_outbox_tenants WHERE tenant_id = $1`, [tenant]);
    });
    await withTenant(tenant, () => deleteReceiptFiles(deps.filesRoot));
  }
}

/**
 * Clone with an event (tenants.md, Series and clone): the source's pizzerias and their menus,
 * hidden ones left behind, into an event that has none yet; never its orders. The tenants module
 * checked the series and the caller before it emitted `tenants.tenant.cloned`.
 */
async function cloneFrom(deps: Deps, source: string, target: string): Promise<void> {
  await noteTenant(deps.db, target);
  await deps.db.global(async (c) => {
    // The app role is bound by RLS: each side is read and written with its own tenant set.
    await asTenant(c, target);
    const has = await c.query(`SELECT 1 FROM pizza_pizzerias LIMIT 1`, []);
    if (has.rows.length > 0) return;
    await asTenant(c, source);
    const { rows } = await c.query(
      `SELECT id, name, phone, website, service FROM pizza_pizzerias WHERE hidden_at IS NULL`,
      [],
    );
    const pizzerias = rows as {
      id: string;
      name: string;
      phone: string | null;
      website: string | null;
      service: string;
    }[];
    const entries = await menuEntries(
      c,
      pizzerias.map((p) => p.id),
    );
    const { rows: positions } = await c.query(
      `SELECT id, position FROM pizza_menu_entries WHERE pizzeria_id = ANY($1::text[])`,
      [pizzerias.map((p) => p.id)],
    );
    const position = new Map(
      (positions as { id: string; position: number }[]).map((r) => [r.id, r.position]),
    );
    await asTenant(c, target);
    // Same ids in the new event: ids are per event (the key is the tenant and the id).
    for (const p of pizzerias) {
      await c.query(
        `INSERT INTO pizza_pizzerias (id, name, phone, website, service) VALUES ($1, $2, $3, $4, $5)`,
        [p.id, p.name, p.phone, p.website, p.service],
      );
    }
    for (const m of entries) {
      await c.query(
        `INSERT INTO pizza_menu_entries (id, pizzeria_id, kind, number, name, description, price_cents, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          m.id,
          m.pizzeria_id,
          m.kind,
          m.number,
          m.name,
          m.description,
          m.price_cents,
          position.get(m.id) ?? 0,
        ],
      );
    }
  });
}
