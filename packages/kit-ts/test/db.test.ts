import { describe, expect, it } from "vitest";
import {
  CURRENT_TENANT_SQL,
  NoTenant,
  RlsBypassed,
  TENANT_COLUMN_SQL,
  checkAppRole,
  currentTenant,
  rlsSql,
  tenantTransaction,
  withTenant,
} from "../src/index.js";
import type { SqlClient } from "../src/index.js";

class FakeClient implements SqlClient {
  readonly calls: [string, unknown[] | undefined][] = [];
  rows: Record<string, unknown>[] = [];
  failOn?: string;

  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> {
    this.calls.push([text, values]);
    if (this.failOn !== undefined && text.includes(this.failOn)) {
      return Promise.reject(new Error("boom"));
    }
    return Promise.resolve({ rows: this.rows });
  }
}

describe("tenantTransaction", () => {
  it("sets the tenant with SET LOCAL semantics inside one transaction", async () => {
    const client = new FakeClient();
    const result = await tenantTransaction(
      client,
      async (c) => {
        await c.query("SELECT 1");
        return currentTenant();
      },
      { tenant: "demo" },
    );
    expect(result).toBe("demo");
    expect(client.calls).toEqual([
      ["BEGIN", undefined],
      ["SELECT set_config('canccu.tenant', $1, true)", ["demo"]],
      ["SELECT 1", undefined],
      ["COMMIT", undefined],
    ]);
  });

  it("takes the tenant from the context when none is given", async () => {
    const client = new FakeClient();
    await withTenant("demo", () => tenantTransaction(client, () => Promise.resolve()));
    expect(client.calls[1]?.[1]).toEqual(["demo"]);
  });

  it("refuses to start without a tenant", async () => {
    const client = new FakeClient();
    await expect(tenantTransaction(client, () => Promise.resolve())).rejects.toThrow(NoTenant);
    expect(client.calls).toEqual([]);
  });

  it("rolls back and rethrows when the work fails", async () => {
    const client = new FakeClient();
    client.failOn = "INSERT";
    await expect(
      tenantTransaction(client, (c) => c.query("INSERT x"), { tenant: "demo" }),
    ).rejects.toThrow("boom");
    expect(client.calls.map(([t]) => t).slice(-1)).toEqual(["ROLLBACK"]);
  });
});

describe("RLS SQL", () => {
  it("defaults the column to the tenant setting and treats an empty setting as none", () => {
    expect(CURRENT_TENANT_SQL).toBe("NULLIF(current_setting('canccu.tenant', true), '')");
    expect(TENANT_COLUMN_SQL).toBe(`tenant_id text NOT NULL DEFAULT ${CURRENT_TENANT_SQL}`);
  });

  it("enables, forces and adds the tenant policy", () => {
    expect(rlsSql("pizza_orders")).toBe(
      [
        "ALTER TABLE pizza_orders ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE pizza_orders FORCE ROW LEVEL SECURITY;",
        `CREATE POLICY canccu_tenant ON pizza_orders USING (tenant_id = ${CURRENT_TENANT_SQL})` +
          ` WITH CHECK (tenant_id = ${CURRENT_TENANT_SQL});`,
      ].join("\n"),
    );
  });

  it("refuses a table name that is not a plain identifier", () => {
    expect(() => rlsSql("x; DROP TABLE y")).toThrow(/table/);
  });
});

describe("checkAppRole", () => {
  it("passes a role that is subject to RLS", async () => {
    const client = new FakeClient();
    client.rows = [{ rolname: "app", rolsuper: false, rolbypassrls: false }];
    await expect(checkAppRole(client)).resolves.toBeUndefined();
  });

  it("refuses a superuser or a BYPASSRLS role", async () => {
    const client = new FakeClient();
    client.rows = [{ rolname: "canccu", rolsuper: true, rolbypassrls: false }];
    await expect(checkAppRole(client)).rejects.toThrow(RlsBypassed);
    client.rows = [{ rolname: "app", rolsuper: false, rolbypassrls: true }];
    await expect(checkAppRole(client)).rejects.toThrow(/bypasses/);
  });
});

describe("tenantTransaction safety", () => {
  it("refuses a tenant transaction nested on the same connection", async () => {
    const client = new FakeClient();
    await expect(
      tenantTransaction(
        client,
        (c) => tenantTransaction(c, () => Promise.resolve(), { tenant: "beta" }),
        { tenant: "acme" },
      ),
    ).rejects.toThrow(/already/);
    expect(client.calls.map(([t]) => t)).toEqual([
      "BEGIN",
      "SELECT set_config('canccu.tenant', $1, true)",
      "ROLLBACK",
    ]);
    await tenantTransaction(client, () => Promise.resolve(), { tenant: "acme" });
  });

  it("refuses a pool, whose queries could each run on another connection", async () => {
    const pool = Object.assign(new FakeClient(), { totalCount: 0, idleCount: 0 });
    await expect(
      tenantTransaction(pool, () => Promise.resolve(), { tenant: "acme" }),
    ).rejects.toThrow(/pool/);
    expect(pool.calls).toEqual([]);
  });

  it("rethrows the work's error even when ROLLBACK fails too", async () => {
    const client = new FakeClient();
    client.failOn = "INSERT";
    const original = client.query.bind(client);
    client.query = (text, values) =>
      text === "ROLLBACK" ? Promise.reject(new Error("connection lost")) : original(text, values);
    await expect(
      tenantTransaction(client, (c) => c.query("INSERT x"), { tenant: "demo" }),
    ).rejects.toThrow("boom");
  });
});
