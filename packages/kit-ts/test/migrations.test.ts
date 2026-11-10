import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORM_MIGRATION_LOCK, quoteIdent, runMigrations } from "../src/index.js";

/** Records statements and plays a ledger, so the order and the once-only rule are visible. */
function fakeClient(ran: Set<string> = new Set()) {
  const log: string[] = [];
  const locks: [string, unknown][] = [];
  let pending: string | undefined;
  return {
    log,
    locks,
    query(text: string, values?: unknown[]) {
      log.push(text);
      if (text.includes("pg_advisory_")) locks.push([text, values?.[0]]);
      if (text.startsWith("SELECT 1 FROM")) {
        return Promise.resolve({ rows: ran.has(String(values?.[0])) ? [{ one: 1 }] : [] });
      }
      if (text.startsWith("INSERT INTO")) pending = String(values?.[0]);
      if (text === "COMMIT" && pending !== undefined) {
        ran.add(pending);
        pending = undefined;
      }
      if (text.includes("boom")) return Promise.reject(new Error("boom"));
      return Promise.resolve({ rows: [] as Record<string, unknown>[] });
    },
  };
}

async function dir(files: Record<string, string>): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "canccu-mig-"));
  for (const [name, sql] of Object.entries(files)) await writeFile(join(d, name), sql);
  return d;
}

describe("runMigrations", () => {
  it("runs new files once, in name order, each in its own transaction, under the lock", async () => {
    const d = await dir({
      "002_b.sql": "CREATE TABLE b ()",
      "001_a.sql": "CREATE TABLE a ()",
      "x.txt": "no",
    });
    const ran = new Set<string>();
    const first = fakeClient(ran);
    expect(await runMigrations(first, d, { ledger: "m_migrations", lock: 7 })).toEqual([
      "001_a.sql",
      "002_b.sql",
    ]);
    expect(first.log.slice(0, 2)).toEqual([
      "SELECT pg_advisory_lock($1)",
      "SELECT pg_advisory_lock($1)",
    ]);
    expect(first.log.at(-1)).toBe("SELECT pg_advisory_unlock($1)");
    expect(first.log.indexOf("CREATE TABLE a ()")).toBeLessThan(
      first.log.indexOf("CREATE TABLE b ()"),
    );
    const second = fakeClient(ran);
    expect(await runMigrations(second, d, { ledger: "m_migrations", lock: 7 })).toEqual([]);
    expect(second.log).not.toContain("CREATE TABLE a ()");
  });

  it("rolls a failing file back, records nothing for it and still unlocks", async () => {
    const d = await dir({ "001_a.sql": "boom" });
    const client = fakeClient();
    await expect(runMigrations(client, d, { ledger: "m_migrations", lock: 7 })).rejects.toThrow(
      "boom",
    );
    expect(client.log).toContain("ROLLBACK");
    expect(client.locks.slice(-2)).toEqual([
      ["SELECT pg_advisory_unlock($1)", 7],
      ["SELECT pg_advisory_unlock($1)", PLATFORM_MIGRATION_LOCK],
    ]);
  });

  it("grants the app role to the login role, quoted", async () => {
    const client = fakeClient();
    await runMigrations(client, await dir({}), {
      ledger: "m_migrations",
      lock: 7,
      appRole: "canccu_m_app",
      grantTo: 'odd"name',
    });
    // The grant changes shared catalog rows too, so it runs under both locks.
    expect(client.log.slice(-3)).toEqual([
      'GRANT "canccu_m_app" TO "odd""name"',
      "SELECT pg_advisory_unlock($1)",
      "SELECT pg_advisory_unlock($1)",
    ]);
    expect(quoteIdent("a")).toBe('"a"');
  });

  it("holds the platform lock, kit-py's key, around the module's own lock", async () => {
    const client = fakeClient();
    await runMigrations(client, await dir({}), { ledger: "m_migrations", lock: 7 });
    expect(PLATFORM_MIGRATION_LOCK).toBe(0x63616e6363);
    expect(client.locks).toEqual([
      ["SELECT pg_advisory_lock($1)", PLATFORM_MIGRATION_LOCK],
      ["SELECT pg_advisory_lock($1)", 7],
      ["SELECT pg_advisory_unlock($1)", 7],
      ["SELECT pg_advisory_unlock($1)", PLATFORM_MIGRATION_LOCK],
    ]);
  });

  it("refuses a ledger name that is not a plain identifier", async () => {
    await expect(
      runMigrations(fakeClient(), await dir({}), { ledger: "x; DROP", lock: 1 }),
    ).rejects.toThrow(RangeError);
  });
});
