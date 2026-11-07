/** Test helpers for modules that use the kit: an in-memory StreamStore and leak tests. */
import type { Event, Handler } from "./bus.js";
import { newId } from "./context.js";
import type { StreamEntries, StreamEntry, StreamStore } from "./store.js";
import { withTenant } from "./tenant.js";

export interface XAddCall {
  stream: string;
  fields: Record<string, string>;
  maxlen: number;
  approximate: boolean;
}

/** Keeps streams in memory and records every xadd call (trimming is recorded, not applied). */
export class MemoryStreamStore implements StreamStore {
  readonly streams = new Map<string, StreamEntry[]>();
  readonly calls: XAddCall[] = [];
  healthy = true;
  private seq = 0;
  private waiters: (() => void)[] = [];

  appendRaw(stream: string, fields: Record<string, string>): string {
    this.seq += 1;
    const id = `${this.seq}-0`;
    const list = this.streams.get(stream) ?? [];
    list.push([id, { ...fields }]);
    this.streams.set(stream, list);
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
    return id;
  }

  xadd(
    stream: string,
    fields: Record<string, string>,
    options: { maxlen: number; approximate: boolean },
  ): Promise<string> {
    this.calls.push({ stream, fields: { ...fields }, ...options });
    return Promise.resolve(this.appendRaw(stream, fields));
  }

  private lastId(stream: string): string {
    const list = this.streams.get(stream);
    return list?.[list.length - 1]?.[0] ?? "0-0";
  }

  async xread(
    streams: Record<string, string>,
    options: { blockMs: number; count: number },
  ): Promise<StreamEntries> {
    const start = Object.entries(streams).map(([s, id]): [string, number] => [
      s,
      Number((id === "$" ? this.lastId(s) : id).split("-")[0]),
    ]);
    const collect = (): StreamEntries =>
      start.flatMap(([stream, after]): StreamEntries => {
        const found = (this.streams.get(stream) ?? []).filter(
          ([id]) => Number(id.split("-")[0]) > after,
        );
        return found.length > 0 ? [[stream, found.slice(0, options.count)]] : [];
      });
    const found = collect();
    if (found.length > 0 || options.blockMs <= 0) return found;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, options.blockMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    return collect();
  }

  scan(pattern: string): Promise<string[]> {
    const re = new RegExp(
      `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replaceAll("*", ".*")
        .replaceAll("?", ".")}$`,
    );
    return Promise.resolve([...this.streams.keys()].filter((s) => re.test(s)));
  }

  ping(): Promise<void> {
    return this.healthy ? Promise.resolve() : Promise.reject(new Error("valkey unreachable"));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** A valid tenant event envelope, as another module would publish it. */
export function tenantEvent(
  tenant: string,
  type: string,
  data: Record<string, unknown> = {},
): Event {
  return {
    id: newId(),
    type,
    version: 1,
    time: new Date().toISOString(),
    source: type.split(".")[0] ?? "",
    tenant,
    data,
  };
}

/** One tenant's data reached another (0013 item 8). */
export class TenantLeak extends Error {
  override name = "TenantLeak";
}

export interface IsolationProbe {
  /** Store data containing `marker` for `tenant`, the way a user or another module would. */
  seed(tenant: string, marker: string): Promise<void>;
  /** Read as `tenant`, the way a user or consumer would: a response body, rows, a file list. */
  read(tenant: string): Promise<unknown>;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  return value === undefined ? "" : JSON.stringify(value);
}

/**
 * The cross-tenant leak test for one endpoint or consumer: each tenant must read back its own
 * marker and never the other's. Seed and read run inside withTenant; an HTTP probe also sends the
 * tenant's hostname. A read that does not even return its own marker fails too, so a probe that
 * reads the wrong thing cannot pass.
 */
export async function assertTenantIsolation(
  probe: IsolationProbe,
  tenants: [string, string] = ["leak-a", "leak-b"],
): Promise<void> {
  const markers = new Map(tenants.map((t) => [t, `leak-marker-${t}-${newId()}`]));
  for (const [tenant, marker] of markers)
    await withTenant(tenant, () => probe.seed(tenant, marker));
  for (const tenant of tenants) {
    const text = asText(await withTenant(tenant, () => probe.read(tenant)));
    if (!text.includes(markers.get(tenant) ?? "")) {
      throw new Error(`${tenant} did not read back its own data, so the leak test proves nothing`);
    }
    for (const [other, marker] of markers) {
      if (other !== tenant && text.includes(marker)) {
        throw new TenantLeak(`${tenant} can read data of ${other}`);
      }
    }
  }
}

/** Run a consumer's handler the way the bus does: inside the event's tenant. */
export async function deliverAs(handler: Handler, event: Event): Promise<void> {
  if (event.tenant === undefined) throw new RangeError("a tenant event needs a tenant");
  await withTenant(event.tenant, () => handler(event));
}
