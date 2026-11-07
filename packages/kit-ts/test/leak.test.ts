import { describe, expect, it } from "vitest";
import { currentTenant, requireTenant } from "../src/index.js";
import type { Event } from "../src/index.js";
import { TenantLeak, assertTenantIsolation, deliverAs, tenantEvent } from "../src/testing.js";

/** A toy module store: `scoped` keeps rows per tenant, a leaky one keeps them in one list. */
function toyStore(scoped: boolean) {
  const rows: { tenant: string; note: string }[] = [];
  return {
    add(note: string) {
      rows.push({ tenant: requireTenant(), note });
    },
    list() {
      return rows.filter((r) => !scoped || r.tenant === requireTenant()).map((r) => r.note);
    },
  };
}

describe("assertTenantIsolation (endpoints)", () => {
  it("passes a module that keeps tenants apart", async () => {
    const store = toyStore(true);
    await assertTenantIsolation({
      seed: (_tenant, marker) => {
        store.add(marker);
        return Promise.resolve();
      },
      read: () => Promise.resolve({ notes: store.list() }),
    });
  });

  it("fails a module that shows one tenant's data to another", async () => {
    const store = toyStore(false);
    await expect(
      assertTenantIsolation({
        seed: (_tenant, marker) => {
          store.add(marker);
          return Promise.resolve();
        },
        read: () => Promise.resolve(store.list()),
      }),
    ).rejects.toThrow(TenantLeak);
  });

  it("fails a read that returns nothing, because it would prove nothing", async () => {
    await expect(
      assertTenantIsolation({ seed: () => Promise.resolve(), read: () => Promise.resolve([]) }),
    ).rejects.toThrow(/proves nothing/);
  });

  it("runs seed and read inside each tenant's context", async () => {
    const seen: (string | undefined)[] = [];
    const store = toyStore(true);
    await assertTenantIsolation(
      {
        seed: (tenant, marker) => {
          seen.push(currentTenant(), tenant);
          store.add(marker);
          return Promise.resolve();
        },
        read: (tenant) => {
          seen.push(currentTenant(), tenant);
          return Promise.resolve(store.list().join(","));
        },
      },
      ["t-one", "t-two"],
    );
    expect(seen).toEqual(["t-one", "t-one", "t-two", "t-two", "t-one", "t-one", "t-two", "t-two"]);
  });
});

describe("deliverAs (consumers)", () => {
  it("runs a handler as the bus would, in the event's tenant", async () => {
    const store = toyStore(true);
    const handler = (event: Event) => {
      store.add(String(event.data.note));
    };
    await assertTenantIsolation({
      seed: (tenant, marker) =>
        deliverAs(handler, tenantEvent(tenant, "pizza.order.placed", { note: marker })),
      read: () => Promise.resolve(store.list()),
    });
  });

  it("refuses an event without a tenant", async () => {
    const event = { ...tenantEvent("demo", "pizza.order.placed") };
    delete event.tenant;
    await expect(deliverAs(() => undefined, event)).rejects.toThrow(/tenant/);
  });
});
