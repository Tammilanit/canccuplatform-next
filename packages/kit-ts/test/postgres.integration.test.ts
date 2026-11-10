/**
 * RLS against a real Postgres: skipped unless CANCCU_DATABASE_URL is set (see README, Integration
 * test). The URL's role must be able to create roles and tables; the tests then run as a plain
 * app role, because a superuser bypasses RLS.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PLATFORM_MIGRATION_LOCK,
  RlsBypassed,
  TENANT_COLUMN_SQL,
  checkAppRole,
  checkLoginRole,
  rlsSql,
  runMigrations,
  tenantTransaction,
} from "../src/index.js";

const url = process.env.CANCCU_DATABASE_URL;
const APP_ROLE = "canccu_kit_test_app";

describe.skipIf(!url)("tenant tables in Postgres", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query(`
      DROP TABLE IF EXISTS kit_test_items, kit_test_lists;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE ${APP_ROLE} NOLOGIN;
        END IF;
      END $$;
      CREATE TABLE kit_test_lists (
        ${TENANT_COLUMN_SQL},
        id text NOT NULL,
        PRIMARY KEY (tenant_id, id)
      );
      CREATE TABLE kit_test_items (
        ${TENANT_COLUMN_SQL},
        id text NOT NULL,
        list_id text NOT NULL,
        PRIMARY KEY (tenant_id, id),
        FOREIGN KEY (tenant_id, list_id) REFERENCES kit_test_lists (tenant_id, id)
      );
      ${rlsSql("kit_test_lists")}
      ${rlsSql("kit_test_items")}
      GRANT SELECT, INSERT, UPDATE, DELETE ON kit_test_lists, kit_test_items TO ${APP_ROLE};
    `);
    await client.query(`SET ROLE ${APP_ROLE}`);
    for (const tenant of ["leak-a", "leak-b"]) {
      await tenantTransaction(
        client,
        (c) => c.query("INSERT INTO kit_test_lists (id) VALUES ('shared-id')"),
        { tenant },
      );
    }
  });

  afterAll(async () => {
    await client.query("RESET ROLE");
    await client.query("DROP TABLE IF EXISTS kit_test_items, kit_test_lists");
    await client.end();
  });

  const listIds = (tenant: string): Promise<string[]> =>
    tenantTransaction(
      client,
      async (c) =>
        (await c.query("SELECT tenant_id FROM kit_test_lists")).rows.map(
          (r: { tenant_id: string }) => r.tenant_id,
        ),
      { tenant },
    );

  it("lets each tenant see only its own rows; the column default fills tenant_id", async () => {
    expect(await listIds("leak-a")).toEqual(["leak-a"]);
    expect(await listIds("leak-b")).toEqual(["leak-b"]);
  });

  it("shows nothing with no tenant set, also on a connection that just ended a tenant transaction", async () => {
    await listIds("leak-a");
    expect((await client.query("SELECT * FROM kit_test_lists")).rows).toEqual([]);
  });

  it("refuses an insert with no tenant set", async () => {
    await expect(client.query("INSERT INTO kit_test_lists (id) VALUES ('x')")).rejects.toThrow(
      /null value|violates/,
    );
  });

  it("refuses writing a row for another tenant", async () => {
    await expect(
      tenantTransaction(
        client,
        (c) => c.query("INSERT INTO kit_test_lists (tenant_id, id) VALUES ('leak-b', 'y')"),
        { tenant: "leak-a" },
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses a reference to another tenant's row through the composite foreign key", async () => {
    await expect(
      tenantTransaction(
        client,
        (c) => c.query("INSERT INTO kit_test_items (id, list_id) VALUES ('i', 'missing-in-a')"),
        { tenant: "leak-a" },
      ),
    ).rejects.toThrow(/foreign key/);
    await tenantTransaction(
      client,
      (c) => c.query("INSERT INTO kit_test_items (id, list_id) VALUES ('i', 'shared-id')"),
      { tenant: "leak-a" },
    );
  });

  it("accepts the app role and refuses the superuser", async () => {
    await expect(checkAppRole(client)).resolves.toBeUndefined();
    await client.query("RESET ROLE");
    try {
      await expect(checkAppRole(client)).rejects.toThrow(RlsBypassed);
    } finally {
      await client.query(`SET ROLE ${APP_ROLE}`);
    }
  });

  it("refuses the login role behind SET ROLE when it owns the tables", async () => {
    // The test's login role created kit_test_lists, so its owner could switch RLS off.
    await expect(checkLoginRole(client)).rejects.toThrow(RlsBypassed);
  });
});

describe.skipIf(!url)("migrations of several modules in Postgres", () => {
  async function waitsOnALock(watcher: pg.Client, pid: number): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const { rows } = await watcher.query<{ wait_event_type: string | null }>(
        "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
        [pid],
      );
      if (rows[0]?.wait_event_type === "Lock") return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`backend ${pid} never waited on a lock`);
  }

  it("waits while another module's migrations run, though its own lock is free", async () => {
    const d = await mkdtemp(join(tmpdir(), "canccu-mig-"));
    await writeFile(join(d, "001.sql"), "CREATE TABLE kit_ts_mig_second ()");
    // `other` stands in for another module mid-run, in either kit: it holds the platform lock.
    const [other, migrator] = [
      new pg.Client({ connectionString: url }),
      new pg.Client({ connectionString: url }),
    ];
    await other.connect();
    await migrator.connect();
    const tables = "kit_ts_mig_second, kit_ts_mig_second_m";
    let run: Promise<string[]> | undefined;
    try {
      await other.query(`DROP TABLE IF EXISTS ${tables}`);
      await other.query("SELECT pg_advisory_lock($1)", [PLATFORM_MIGRATION_LOCK]);
      const [{ pid }] = (await migrator.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
        .rows as [{ pid: number }];
      run = runMigrations(migrator, d, { ledger: "kit_ts_mig_second_m", lock: 0x6b172803 });
      await waitsOnALock(other, pid);
      const before = await other.query<{ t: string | null }>(
        "SELECT to_regclass('kit_ts_mig_second') AS t",
      );
      expect(before.rows).toEqual([{ t: null }]);

      await other.query("SELECT pg_advisory_unlock($1)", [PLATFORM_MIGRATION_LOCK]);
      expect(await run).toEqual(["001.sql"]);
    } finally {
      await other.query("SELECT pg_advisory_unlock_all()");
      await run?.catch(() => undefined);
      await other.query(`DROP TABLE IF EXISTS ${tables}`);
      await other.end();
      await migrator.end();
    }
  });
});
