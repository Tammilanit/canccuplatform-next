import { describe, expect, it } from "vitest";
import {
  Bus,
  InvalidEnvelope,
  NoTenant,
  currentTenant,
  parseEnvelope,
  tenantStream,
  withTenant,
} from "../src/index.js";
import type { Event } from "../src/index.js";
import { MemoryStreamStore, tenantEvent } from "../src/testing.js";

const body = (store: MemoryStreamStore, i = 0): Record<string, unknown> =>
  JSON.parse(store.calls[i]?.fields.event ?? "") as Record<string, unknown>;

async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("publish with a tenant", () => {
  it("writes a tenant event to t:<tenant>:events:<module> with tenant in the envelope", async () => {
    const store = new MemoryStreamStore();
    const bus = new Bus(store, "pizza");
    const event = await withTenant("demo", () =>
      bus.publish("pizza.order.placed", { n: 1 }, { version: 1 }),
    );
    expect(store.calls[0]?.stream).toBe("t:demo:events:pizza");
    expect(body(store)).toMatchObject({ tenant: "demo", source: "pizza" });
    expect(event.tenant).toBe("demo");
  });

  it("takes an explicit tenant over the context", async () => {
    const store = new MemoryStreamStore();
    await new Bus(store, "pizza").publish(
      "pizza.order.placed",
      {},
      { version: 1, tenant: "other" },
    );
    expect(store.calls[0]?.stream).toBe("t:other:events:pizza");
  });

  it("refuses to publish with no tenant unless it is a platform event", async () => {
    const store = new MemoryStreamStore();
    const bus = new Bus(store, "tenants");
    await expect(bus.publish("tenants.tenant.created", {}, { version: 1 })).rejects.toThrow(
      NoTenant,
    );
    await bus.publish("tenants.tenant.created", { tenant_id: "x" }, { version: 1, platform: true });
    expect(store.calls.map((c) => c.stream)).toEqual(["events:tenants"]);
    expect(body(store)).not.toHaveProperty("tenant");
  });

  it("refuses a platform event that also names a tenant", async () => {
    const bus = new Bus(new MemoryStreamStore(), "tenants");
    await expect(
      bus.publish("tenants.tenant.created", {}, { version: 1, platform: true, tenant: "demo" }),
    ).rejects.toThrow(/platform/);
  });
});

describe("envelope tenant", () => {
  it("parses and checks tenant", () => {
    const raw = (tenant: unknown) =>
      JSON.stringify({
        id: "1",
        type: "pizza.order.placed",
        version: 1,
        time: "t",
        source: "pizza",
        tenant,
        data: {},
      });
    expect(parseEnvelope(raw("demo")).tenant).toBe("demo");
    expect(() => parseEnvelope(raw("../x"))).toThrow(InvalidEnvelope);
    expect(() => parseEnvelope(raw(5))).toThrow(InvalidEnvelope);
  });
});

describe("subscribeTenants", () => {
  function setup(modules = ["pizza"]) {
    const store = new MemoryStreamStore();
    const seen: [string | undefined, Event][] = [];
    const sub = new Bus(store, "screen").subscribeTenants(
      modules,
      (event) => {
        seen.push([currentTenant(), event]);
      },
      { blockMs: 20, rescanMs: 50 },
    );
    return { store, seen, sub };
  }

  it("reads existing tenants' streams and runs the handler in the message's tenant", async () => {
    const store = new MemoryStreamStore();
    store.appendRaw("t:demo:events:pizza", {
      event: JSON.stringify(tenantEvent("demo", "pizza.order.placed")),
    });
    const seen: [string | undefined, Event][] = [];
    const sub = new Bus(store, "screen").subscribeTenants(
      ["pizza"],
      (e) => {
        seen.push([currentTenant(), e]);
      },
      { blockMs: 20, fromId: "0" },
    );
    await until(() => seen.length === 1);
    expect(seen[0]?.[0]).toBe("demo");
    await sub.close();
  });

  it("picks up a new tenant from tenants.tenant.created and reads it from the start", async () => {
    const { store, seen, sub } = setup();
    await new Promise((r) => setTimeout(r, 30));
    store.appendRaw("t:new-one:events:pizza", {
      event: JSON.stringify(tenantEvent("new-one", "pizza.order.placed")),
    });
    store.appendRaw("events:tenants", {
      event: JSON.stringify({
        id: "c1",
        type: "tenants.tenant.created",
        version: 1,
        time: "t",
        source: "tenants",
        data: { tenant_id: "new-one", status: "draft" },
      }),
    });
    await until(() => seen.length === 1);
    expect(seen[0]?.[0]).toBe("new-one");
    await sub.close();
  });

  it("finds a stream that appeared without a created event on the next rescan", async () => {
    const { store, seen, sub } = setup();
    await new Promise((r) => setTimeout(r, 30));
    store.appendRaw("t:late:events:pizza", {
      event: JSON.stringify(tenantEvent("late", "pizza.order.placed")),
    });
    await until(() => seen.length === 1);
    expect(seen[0]?.[0]).toBe("late");
    await sub.close();
  });

  it("drops a message whose tenant does not match its stream", async () => {
    const { store, seen, sub } = setup();
    await new Promise((r) => setTimeout(r, 30));
    store.appendRaw("t:aaa:events:pizza", {
      event: JSON.stringify(tenantEvent("bbb", "pizza.order.placed")),
    });
    store.appendRaw("t:aaa:events:pizza", {
      event: JSON.stringify(tenantEvent("aaa", "pizza.order.placed")),
    });
    await until(() => seen.length === 1);
    await new Promise((r) => setTimeout(r, 60));
    expect(seen.map(([t, e]) => [t, e.tenant])).toEqual([["aaa", "aaa"]]);
    await sub.close();
  });

  it("stops reading a deleted tenant", async () => {
    const { store, seen, sub } = setup();
    await new Promise((r) => setTimeout(r, 30));
    store.appendRaw("events:tenants", {
      event: JSON.stringify({
        id: "d1",
        type: "tenants.tenant.deleted",
        version: 1,
        time: "t",
        source: "tenants",
        data: { tenant_id: "gone" },
      }),
    });
    await new Promise((r) => setTimeout(r, 40));
    store.appendRaw(tenantStream("pizza", "gone"), {
      event: JSON.stringify(tenantEvent("gone", "pizza.order.placed")),
    });
    await new Promise((r) => setTimeout(r, 120));
    expect(seen).toEqual([]);
    await sub.close();
  });
});

describe("positions while a handler runs", () => {
  it("delivers an event on one tenant's stream that arrives while another's handler runs", async () => {
    const store = new MemoryStreamStore();
    const seed = (tenant: string) =>
      store.appendRaw(tenantStream("pizza", tenant), {
        event: JSON.stringify(tenantEvent(tenant, "pizza.order.placed")),
      });
    seed("acme");
    seed("beta");
    const seen: (string | undefined)[] = [];
    const sub = new Bus(store, "screen").subscribeTenants(
      ["pizza"],
      async (event) => {
        seen.push(event.tenant);
        // While acme's handler runs, beta publishes; that event must not be skipped.
        if (event.tenant === "acme") {
          seed("beta");
          await new Promise((r) => setTimeout(r, 30));
        }
      },
      { blockMs: 20 },
    );
    await new Promise((r) => setTimeout(r, 30));
    seed("acme");
    await until(() => seen.length === 2);
    await new Promise((r) => setTimeout(r, 60));
    expect(seen).toEqual(["acme", "beta"]);
    await sub.close();
  });
});
