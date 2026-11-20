/**
 * The Food pages' live stream (`GET /api/pizza/stream`, contracts/pizza.md, Live; D13, E16): each
 * container reads its event streams off the bus, as every container must (the bus has no consumer
 * groups and a write may land on another replica), and tells the pages open on it that an order
 * changed. A change carries the order's id, state and revision, never who or what: a page reads
 * the order again through the API, which draws it for its caller. A page that reconnects reads it
 * again too, so nothing is replayed and nothing is lost.
 */
import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { Event } from "@canccu/kit";
import { guestRead, tenantOf, whoIs } from "./http.js";
import type { AppDeps } from "./http.js";

/** Proxies drop a quiet connection; a comment line this often keeps it open. */
export const KEEPALIVE_MS = 25_000;
/** How soon a browser's EventSource tries again after the stream drops. */
const RETRY_MS = 3000;
const ID = /^po_[A-Za-z0-9_-]{1,40}$/;

class LiveStream {
  readonly out = new PassThrough();

  constructor(
    readonly tenant: string,
    readonly order: string | null,
  ) {}

  send(event: string, data: Record<string, unknown>): void {
    this.out.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

export class LiveHub {
  private readonly streams = new Map<string, Set<LiveStream>>();
  private readonly keepalive: NodeJS.Timeout;

  constructor() {
    this.keepalive = setInterval(() => {
      for (const set of this.streams.values()) for (const s of set) s.out.write(": keep-alive\n\n");
    }, KEEPALIVE_MS);
    this.keepalive.unref();
  }

  /** The open streams, all events together. */
  size(): number {
    let n = 0;
    for (const set of this.streams.values()) n += set.size;
    return n;
  }

  open(tenant: string, order: string | null): LiveStream {
    const s = new LiveStream(tenant, order);
    const set = this.streams.get(tenant) ?? new Set();
    set.add(s);
    this.streams.set(tenant, set);
    s.out.write(`retry: ${RETRY_MS}\n\n`);
    s.send("ready", {});
    return s;
  }

  drop(s: LiveStream): void {
    const set = this.streams.get(s.tenant);
    set?.delete(s);
    if (set?.size === 0) this.streams.delete(s.tenant);
    s.out.end();
  }

  /** One of pizza's own events, from the bus: `pizza.order.*` and `pizza.item.*` reach the pages. */
  handle(e: Event): void {
    if (e.source !== "pizza" || e.tenant === undefined) return;
    const order = e.data.order as { id?: unknown; state?: unknown; revision?: unknown } | undefined;
    let change: Record<string, unknown>;
    if (e.type.startsWith("pizza.order.") && typeof order?.id === "string")
      change = { type: e.type, order_id: order.id, state: order.state, revision: order.revision };
    else if (e.type.startsWith("pizza.item.") && typeof e.data.order_id === "string")
      change = { type: e.type, order_id: e.data.order_id, revision: e.data.order_revision };
    else return;
    for (const s of this.streams.get(e.tenant) ?? [])
      if (s.order === null || s.order === change.order_id) s.send("change", change);
  }

  close(): void {
    clearInterval(this.keepalive);
    for (const set of [...this.streams.values()]) for (const s of [...set]) this.drop(s);
  }
}

export function liveRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Querystring: { order?: string } }>("/api/pizza/stream", async (request, reply) => {
    const ctx = tenantOf(request);
    const { caller } = await whoIs(deps, request);
    // What the orders' reads allow: a guest only where the info pages let one in (U15).
    guestRead(request, caller);
    const order = request.query.order;
    const s = deps.live.open(ctx.tenant_id, order !== undefined && ID.test(order) ? order : null);
    reply.raw.on("close", () => {
      deps.live.drop(s);
    });
    return (
      reply
        .header("content-type", "text/event-stream; charset=utf-8")
        // No proxy or browser may keep or buffer a live stream.
        .header("cache-control", "no-store")
        .header("x-accel-buffering", "no")
        .send(s.out)
    );
  });
  app.addHook("preClose", (done) => {
    deps.live.close();
    done();
  });
}
