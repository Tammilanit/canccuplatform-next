/**
 * RLS against a real Postgres: skipped unless CANCCU_DATABASE_URL is set (see README, Integration
 * test). The URL's role must be able to create roles and tables; the tests then run as a plain
 * app role, because a superuser bypasses RLS.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RlsBypassed,
  TENANT_COLUMN_SQL,
  checkAppRole,
  checkLoginRole,
  rlsSql,
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
