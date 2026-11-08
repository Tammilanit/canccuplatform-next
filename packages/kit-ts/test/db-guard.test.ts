import { describe, expect, it } from "vitest";
import { RlsBypassed, checkLoginRole, tenantTransaction, trackTransactions } from "../src/index.js";
import type { SqlClient } from "../src/index.js";

class FakeClient implements SqlClient {
  readonly calls: string[] = [];
  rows: Record<string, unknown>[] = [];
  failOn?: string;
  released = 0;

  query(text: string): Promise<{ rows: Record<string, unknown>[] }> {
    this.calls.push(text);
    if (this.failOn !== undefined && text.includes(this.failOn)) {
      return Promise.reject(new Error("boom"));
    }
    return Promise.resolve({ rows: this.rows });
  }

  release(): void {
    this.released += 1;
  }
}

describe("trackTransactions", () => {
  it("follows BEGIN and its endings by the leading keyword", async () => {
    const tracked = trackTransactions(new FakeClient());
    const steps: [string, boolean][] = [
      ["BEGIN", true],
      ["SELECT 1", true],
      ["SAVEPOINT a", true],
      ["rollback to savepoint a", true],
      ["ROLLBACK TO a", true],
      ["COMMIT", false],
      ["  -- a comment\n /* and another */ start transaction isolation level serializable", true],
      ["ROLLBACK", false],
      ["begin", true],
      ["END", false],
      ["BEGIN", true],
      ["ABORT", false],
      ["BEGIN", true],
      ["PREPARE TRANSACTION 'x'", false],
      ["COMMIT PREPARED 'x'", false],
      ["BEGIN", true],
      ["ROLLBACK TRANSACTION TO SAVEPOINT a", true],
      ["COMMIT AND CHAIN", true],
      ["ROLLBACK AND NO CHAIN", false],
    ];
    for (const [sql, open] of steps) {
      await tracked.query(sql);
      expect([sql, tracked.inTransaction]).toEqual([sql, open]);
    }
  });

  it("keeps an aborted transaction open until it ends, as Postgres does", async () => {
    const inner = new FakeClient();
    const tracked = trackTransactions(inner);
    await tracked.query("BEGIN");
    inner.failOn = "INSERT";
    await expect(tracked.query("INSERT x")).rejects.toThrow("boom");
    expect(tracked.inTransaction).toBe(true);
    inner.failOn = "COMMIT";
    await expect(tracked.query("COMMIT")).rejects.toThrow("boom");
    expect(tracked.inTransaction).toBe(false);
  });

  it("passes release through to the inner client", () => {
    const inner = new FakeClient();
    trackTransactions(inner).release();
    expect(inner.released).toBe(1);
  });
});

describe("tenantTransaction on a tracked client", () => {
  it("throws inside the caller's own transaction and runs no query", async () => {
    const inner = new FakeClient();
    const tracked = trackTransactions(inner);
    await tracked.query("BEGIN");
    await expect(
      tenantTransaction(tracked, () => tracked.query("SELECT 1"), { tenant: "demo" }),
    ).rejects.toThrow("the connection is already in a transaction");
    expect(inner.calls).toEqual(["BEGIN"]);
  });

  it("runs its own BEGIN and COMMIT through the wrapper, so the flag stays right", async () => {
    const inner = new FakeClient();
    const tracked = trackTransactions(inner);
    const seen = await tenantTransaction(tracked, (c) => Promise.resolve(c.inTransaction), {
      tenant: "demo",
    });
    expect(seen).toBe(true);
    expect(tracked.inTransaction).toBe(false);
    inner.failOn = "INSERT";
    await expect(
      tenantTransaction(tracked, (c) => c.query("INSERT x"), { tenant: "demo" }),
    ).rejects.toThrow("boom");
    expect(tracked.inTransaction).toBe(false);
    expect(inner.calls.at(-1)).toBe("ROLLBACK");
  });
});

describe("checkLoginRole", () => {
  const role = (over: Record<string, unknown> = {}) => ({
    rolname: "login",
    rolsuper: false,
    rolbypassrls: false,
    owns_relations: false,
    ...over,
  });

  it("passes a login role that owns nothing and is bound by RLS", async () => {
    const client = new FakeClient();
    client.rows = [role()];
    await expect(checkLoginRole(client)).resolves.toBeUndefined();
    // The login role, not the role a SET ROLE switched to.
    expect(client.calls[0]).toMatch(/session_user/);
    expect(client.calls[0]).toMatch(/pg_class/);
  });

  it("refuses a superuser, a BYPASSRLS role, or a role that owns relations", async () => {
    for (const [over, reason] of [
      [{ rolsuper: true }, /superuser/],
      [{ rolbypassrls: true }, /BYPASSRLS/],
      [{ owns_relations: true }, /owns/],
    ] as const) {
      const client = new FakeClient();
      client.rows = [role(over)];
      await expect(checkLoginRole(client)).rejects.toThrow(RlsBypassed);
      await expect(checkLoginRole(client)).rejects.toThrow(reason);
    }
    await expect(checkLoginRole(new FakeClient())).rejects.toThrow(RlsBypassed);
  });
});
