import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "@canccu/kit";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_ROLE, MIGRATIONS_DIR } from "../src/db.js";
import { DATABASE_URL, dropTables } from "./helpers.js";

describe.skipIf(!DATABASE_URL)("migrations", () => {
  let admin: pg.Client;
  let dir: string;
  const migrate = () => runMigrations(admin, dir, { ledger: "screen_migrations", lock: 1 });
  /** Copies the module's migrations before `name` (or all of them) into the run's directory. */
  const upTo = async (name?: string) => {
    for (const file of (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort()) {
      if (name !== undefined && file >= name) break;
      await cp(join(MIGRATIONS_DIR, file), join(dir, file));
    }
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropTables(admin);
    dir = await mkdtemp(join(tmpdir(), "canccu-screen-migrations-"));
  });
  afterAll(async () => {
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  });

  it("renames assignments to screen_assignments, keeping rows, RLS and grants", async () => {
    await upTo("007_screen_assignments.sql");
    await migrate();
    await admin.query(
      "INSERT INTO devices (id, name, current_tenant_id) VALUES ('dv_1', 'A', 'alpha')",
    );
    await admin.query(
      "INSERT INTO screen_zones (tenant_id, key, name, epoch) VALUES ('alpha', 'hall', 'Hall', 'e1')",
    );
    await admin.query(
      "INSERT INTO assignments (tenant_id, device_id, zone_key) VALUES ('alpha', 'dv_1', 'hall')",
    );
    await upTo();
    await migrate();

    const kept = await admin.query("SELECT tenant_id, device_id, zone_key FROM screen_assignments");
    expect(kept.rows).toEqual([{ tenant_id: "alpha", device_id: "dv_1", zone_key: "hall" }]);
    const table = await admin.query(
      `SELECT relrowsecurity, relforcerowsecurity,
              has_table_privilege($1, oid, 'SELECT, INSERT, UPDATE, DELETE') AS granted,
              (SELECT count(*)::int FROM pg_policy WHERE polrelid = c.oid) AS policies
       FROM pg_class c WHERE relname = 'screen_assignments'`,
      [APP_ROLE],
    );
    expect(table.rows).toEqual([
      { relrowsecurity: true, relforcerowsecurity: true, granted: true, policies: 1 },
    ]);
    expect((await admin.query("SELECT to_regclass('assignments') AS old")).rows).toEqual([
      { old: null },
    ]);
  });

  // The zone above was made before 008 ran, so it shows what 008 gives existing zones.
  it("gives existing zones the contract's defaults for `header` and `hub_qr`", async () => {
    const kept = await admin.query("SELECT key, header, hub_qr FROM screen_zones");
    expect(kept.rows).toEqual([{ key: "hall", header: null, hub_qr: "always" }]);
    await expect(
      admin.query("UPDATE screen_zones SET hub_qr = 'never' WHERE key = 'hall'"),
    ).rejects.toThrow();
    await expect(
      admin.query("UPDATE screen_zones SET header = 'rotating' WHERE key = 'hall'"),
    ).rejects.toThrow();
  });
});
