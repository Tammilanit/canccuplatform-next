/**
 * The transactional outbox against a real Postgres (RLS cannot be faked), ported from kit-py's
 * tests/test_outbox.py. Skipped unless CANCCU_DATABASE_URL is set, as postgres.integration.test.ts;
 * table and role names are this test's own, so it shares a database with the others.
 */
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Bus,
  Outbox,
  TENANT_COLUMN_SQL,
  requireTenant,
  rlsSql,
  tenantTransaction,
  withTenant,
} from "../src/index.js";
import type { OutboxDb, SqlClient } from "../src/index.js";
import { MemoryStreamStore } from "../src/testing.js";

const url = process.env.CANCCU_DATABASE_URL;
const APP_ROLE = "canccu_kit_test_outbox_app";

/** Refuses the next `failures` appends, as Valkey does while it is down. */
class FlakyStore extends MemoryStreamStore {
  failures = 0;
  override xadd(
    stream: string,
    fields: Record<string, string>,
    options: { maxlen: number; approximate: boolean },
  ): Promise<string> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new Error("valkey unreachable"));
    }
    return super.xadd(stream, fields, options);
  }
}

describe.skipIf(!url)("the outbox", () => {
  let pool: pg.Pool;
  let store: FlakyStore;
  let outbox: Outbox;

  /** A module's Db: the current tenant's transactions, and global ones, as the app role. */
  const db: OutboxDb = {
    async tenant<T>(fn: (c: SqlClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        return await tenantTransaction(client, async (c) => {
          await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
          return fn(c);
        });
      } finally {
        client.release();
      }
    },
    async global<T>(fn: (c: SqlClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
  const write = (tenant: string, fn: (c: SqlClient) => Promise<unknown>) =>
    withTenant(tenant, () => db.tenant(fn));
  const sent = (tenant: string) =>
    (store.streams.get(`t:${tenant}:events:kittest`) ?? []).map(
      ([, fields]) => JSON.parse(fields.event ?? "") as Record<string, unknown>,
    );
  const ns = (tenant: string) => sent(tenant).map((e) => (e.data as { n: number }).n);
  // As the login role: RLS does not bind it.
  async function pending(): Promise<[number, string[]]> {
    const rows = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM kittest_outbox");
    const tenants = await pool.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM kittest_outbox_tenants",
    );
    return [rows.rows[0]?.n ?? 0, tenants.rows.map((r) => r.tenant_id)];
  }

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(`
      DROP TABLE IF EXISTS kittest_outbox, kittest_outbox_tenants;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE ${APP_ROLE} NOLOGIN;
        END IF;
      END $$;
      CREATE TABLE kittest_outbox (
        ${TENANT_COLUMN_SQL},
        seq bigint GENERATED ALWAYS AS IDENTITY,
        event text NOT NULL,
        PRIMARY KEY (tenant_id, seq)
      );
      ${rlsSql("kittest_outbox")}
      CREATE TABLE kittest_outbox_tenants (tenant_id text PRIMARY KEY);
      GRANT SELECT, INSERT, DELETE ON kittest_outbox TO ${APP_ROLE};
      GRANT SELECT, INSERT, UPDATE, DELETE ON kittest_outbox_tenants TO ${APP_ROLE};
    `);
    store = new FlakyStore();
    outbox = new Outbox(new Bus(store, "kittest"), db);
  });
  afterEach(async () => {
    await pool.query("DROP TABLE IF EXISTS kittest_outbox, kittest_outbox_tenants");
  });

  it("sends a committed write's events after the flush, in order, once", async () => {
    let first = "";
    await write("ev-a", async (c) => {
      first = (await outbox.add(c, "kittest.thing.made", { n: 1 }, { version: 1 })).id;
      await outbox.add(c, "kittest.thing.made", { n: 2 }, { version: 1, correlationId: "c1" });
    });
    expect(sent("ev-a")).toEqual([]);
    expect(await outbox.flush("ev-a")).toBe(2);
    const events = sent("ev-a");
    expect(ns("ev-a")).toEqual([1, 2]);
    expect(events[0]).toMatchObject({ id: first, tenant: "ev-a", source: "kittest" });
    expect(events[1]?.correlation_id).toBe("c1");
    expect(await outbox.flush("ev-a")).toBe(0);
    // An event with nothing pending is forgotten.
    expect(await pending()).toEqual([0, []]);
  });

  it("flushes the tenant in scope by default", async () => {
    await write("ev-a", (c) => outbox.add(c, "kittest.thing.made", { n: 1 }, { version: 1 }));
    expect(await withTenant("ev-a", () => outbox.flush())).toBe(1);
  });

  it("sends nothing for a write that rolled back", async () => {
    await expect(
      write("ev-a", async (c) => {
        await outbox.add(c, "kittest.thing.made", { n: 1 }, { version: 1 });
        throw new Error("the write failed");
      }),
    ).rejects.toThrow("the write failed");
    expect(await outbox.flush("ev-a")).toBe(0);
    expect(sent("ev-a")).toEqual([]);
    expect(await pending()).toEqual([0, []]);
  });

  it("sends a failed send again later, without duplicates", async () => {
    await write("ev-a", async (c) => {
      for (const n of [1, 2, 3]) await outbox.add(c, "kittest.thing.made", { n }, { version: 1 });
    });
    store.failures = 1;
    // Never thrown: the write has committed, so its caller succeeded.
    expect(await outbox.flush("ev-a")).toBe(0);
    expect(await pending()).toEqual([3, ["ev-a"]]);
    expect(await outbox.flushAll()).toBe(3);
    expect(ns("ev-a")).toEqual([1, 2, 3]);
    expect(await pending()).toEqual([0, []]);
  });

  it("never sends again what went out before a failure", async () => {
    await write("ev-a", async (c) => {
      for (const n of [1, 2]) await outbox.add(c, "kittest.thing.made", { n }, { version: 1 });
    });
    const xadd = store.xadd.bind(store);
    let calls = 0;
    store.xadd = (stream, fields, options) => {
      calls += 1;
      return calls === 2
        ? Promise.reject(new Error("valkey unreachable"))
        : xadd(stream, fields, options);
    };
    expect(await outbox.flush("ev-a")).toBe(1);
    expect(await outbox.flush("ev-a")).toBe(1);
    expect(ns("ev-a")).toEqual([1, 2]);
  });

  it("visits every event with pending rows", async () => {
    for (const tenant of ["ev-a", "ev-b"]) {
      await write(tenant, (c) =>
        outbox.add(
          c,
          "kittest.thing.made",
          { n: requireTenant() === "ev-a" ? 1 : 2 },
          { version: 1 },
        ),
      );
    }
    expect(await outbox.flushAll()).toBe(2);
    expect(ns("ev-a")).toEqual([1]);
    expect(ns("ev-b")).toEqual([2]);
  });

  it("refuses another module's event", async () => {
    await expect(
      write("ev-a", (c) => outbox.add(c, "other.thing.made", {}, { version: 1 })),
    ).rejects.toThrow("does not start with this module");
  });
});
