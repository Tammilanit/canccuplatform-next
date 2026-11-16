/** The engine on a real Postgres (RLS needs one), with the bus in memory and a clock the test moves. */
import pg from "pg";
import { Bus, Outbox, runMigrations, withTenant } from "@canccu/kit";
import type { Event, SqlClient } from "@canccu/kit";
import { MemoryStreamStore, requireTestDatabase } from "@canccu/kit/testing";
import { MIGRATIONS_DIR, poolDb } from "../src/db.js";
import type { Db } from "../src/db.js";
import { Engine } from "../src/engine.js";
import { noteTenant } from "../src/tick.js";

/** Tests run only on a database named `*_test` (the harness refuses any other). */
export const DATABASE_URL = process.env.CANCCU_DATABASE_URL;

const TABLES = [
  "moments",
  "moment_overrides",
  "moment_placements",
  "moments_zones",
  "moments_priorities",
  "moments_rules",
  "moments_sources",
  "moments_history",
  "moments_idempotency",
  "moments_outbox",
  "moments_outbox_tenants",
  "moments_tenants",
  "moments_migrations",
];

/** Fresh tables, migrated by the module's own files as at start. */
export async function freshDatabase(): Promise<pg.Pool> {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  try {
    await requireTestDatabase(admin);
    await admin.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
    await runMigrations(admin, MIGRATIONS_DIR, { ledger: "moments_migrations", lock: 3 });
  } finally {
    await admin.end();
  }
  return new pg.Pool({ connectionString: DATABASE_URL });
}

export interface World {
  pool: pg.Pool;
  db: Db;
  store: MemoryStreamStore;
  outbox: Outbox;
  engine: Engine;
  /** The test's clock. */
  now: Date;
  at(seconds: number): Date;
  /** Runs `fn` in one tenant transaction, then sends the outbox, as a request does. */
  tx<T>(tenant: string, fn: (c: SqlClient) => Promise<T>): Promise<T>;
  /** The moments events sent to one event's stream so far. */
  events(tenant: string): Event[];
  /** A new engine on the same database: what a restarted container is. */
  restart(): void;
}

export const T0 = new Date("2026-01-01T18:00:00Z");

export function world(pool: pg.Pool): World {
  const db = poolDb(pool);
  const store = new MemoryStreamStore();
  const make = () => {
    const outbox = new Outbox(new Bus(store, "moments"), db);
    return { outbox, engine: new Engine(outbox) };
  };
  let parts = make();
  const w: World = {
    pool,
    db,
    store,
    get outbox() {
      return parts.outbox;
    },
    get engine() {
      return parts.engine;
    },
    now: T0,
    at: (s) => new Date(T0.getTime() + s * 1000),
    tx: (tenant, fn) =>
      withTenant(tenant, async () => {
        await noteTenant(db, tenant);
        const out = await db.tenant(fn);
        await parts.outbox.flush();
        return out;
      }),
    events: (tenant) =>
      (store.streams.get(`t:${tenant}:events:moments`) ?? []).map(
        ([, fields]) => JSON.parse(fields.event ?? "{}") as Event,
      ),
    restart: () => {
      parts = make();
    },
  };
  return w;
}

/** A report as Screen sends it in `screen.claims.changed`. */
export function claims(
  zone: string,
  placed: [string, string][],
  unplaced: string[] = [],
  hidden: string[] = [],
) {
  return {
    zone_key: zone,
    placed: placed.map(([override_id, role]) => ({ override_id, role })),
    unplaced,
    hidden,
  };
}

export const types = (events: Event[]): string[] => events.map((e) => e.type);
