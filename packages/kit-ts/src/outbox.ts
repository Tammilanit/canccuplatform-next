/**
 * Transactional outbox, as kit-py's (canccu_kit/outbox.py): a write stores its bus events in its
 * own transaction, and they are sent after the commit. A committed write then never loses its
 * events, and a rolled-back one sends none.
 *
 * Each module that uses it has two tables in its migrations (`<module>` is the bus's module):
 *
 *     CREATE TABLE <module>_outbox (
 *       tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
 *       seq bigint GENERATED ALWAYS AS IDENTITY,
 *       event text NOT NULL,
 *       PRIMARY KEY (tenant_id, seq)
 *     );  -- plus the kit's RLS (rlsSql)
 *     CREATE TABLE <module>_outbox_tenants (tenant_id text PRIMARY KEY);  -- a global table
 *     GRANT SELECT, INSERT, DELETE ON <module>_outbox TO <app role>;
 *     -- UPDATE only because row locks (FOR KEY SHARE, FOR UPDATE) need it; nothing updates a row.
 *     GRANT SELECT, INSERT, UPDATE, DELETE ON <module>_outbox_tenants TO <app role>;
 *
 * The second lists the events with pending rows, so `flushAll` finds them without a tenant set.
 *
 * Delivery is at least once: an event sent but not yet deleted when a container stops is sent
 * again with the same id, and subscribers drop a repeated id. Events of one tenant go out in the
 * order they were added.
 */
import type { Bus, PublishOptions } from "./bus.js";
import type { SqlClient } from "./db.js";
import { parseEnvelope } from "./envelope.js";
import type { Event } from "./envelope.js";
import type { Logger } from "./log.js";
import { requireTenant, withTenant } from "./tenant.js";

/** A module's Db: transactions as its app role, for the tenant in scope or for none. */
export interface OutboxDb {
  tenant<T>(fn: (client: SqlClient) => Promise<T>): Promise<T>;
  global<T>(fn: (client: SqlClient) => Promise<T>): Promise<T>;
}

export class Outbox {
  private readonly rows: string;
  private readonly tenants: string;

  constructor(
    readonly bus: Bus,
    private readonly db: OutboxDb,
    private readonly options: { batch?: number; log?: Logger } = {},
  ) {
    this.rows = `${bus.module}_outbox`;
    this.tenants = `${bus.module}_outbox_tenants`;
  }

  /** Stores an event of the tenant in scope, inside the caller's tenant transaction. */
  async add(
    c: SqlClient,
    type: string,
    data: Record<string, unknown>,
    options: Pick<PublishOptions, "version" | "correlationId">,
  ): Promise<Event> {
    const tenant = requireTenant();
    const event = this.bus.envelope(type, data, { ...options, tenant });
    await c.query(`INSERT INTO ${this.rows} (event) VALUES ($1)`, [JSON.stringify(event)]);
    await this.list(c, tenant);
    return event;
  }

  /**
   * Lists the tenant for `flushAll`, and holds its row until the caller commits: the share lock
   * keeps `forget` from dropping the row while this write's events are not yet visible to it. A
   * row a forget deleted meanwhile is gone when the lock is taken: the second insert then adds it
   * again (an insert waits for a delete in flight to finish).
   */
  private async list(c: SqlClient, tenant: string): Promise<void> {
    for (let i = 0; i < 2; i += 1) {
      await c.query(`INSERT INTO ${this.tenants} (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`, [
        tenant,
      ]);
      const { rows } = await c.query(
        `SELECT 1 FROM ${this.tenants} WHERE tenant_id = $1 FOR KEY SHARE`,
        [tenant],
      );
      if (rows.length > 0) return;
    }
    throw new Error("the outbox could not list the event");
  }

  /**
   * Sends the tenant's pending events (by default the tenant in scope); returns how many. Never
   * throws: the write has committed, so its caller succeeded; what is left goes out on a later
   * flush (`flushAll`).
   */
  async flush(tenant: string = requireTenant()): Promise<number> {
    let sent = 0;
    try {
      // Again after every pass that sent something: a writer that committed while this one held
      // the lock found it taken and left its rows to this one.
      for (;;) {
        const { count, failure } = await withTenant(tenant, () => this.flushBatch(tenant));
        sent += count ?? 0;
        if (failure !== undefined) throw failure;
        if (!count) return sent;
      }
    } catch (err) {
      this.options.log?.warn({ err, tenant_id: tenant }, "outbox send failed; retrying later");
      return sent;
    }
  }

  /** How many were sent (undefined when another sender holds the event), and what failed. */
  private flushBatch(tenant: string): Promise<{ count?: number; failure?: Error }> {
    return this.db.tenant(async (c) => {
      // One sender per event at a time keeps the order.
      const lock = await c.query(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS ok",
        [`${this.rows}:${tenant}`],
      );
      if (lock.rows[0]?.ok !== true) return {};
      const { rows } = await c.query(`SELECT seq, event FROM ${this.rows} ORDER BY seq LIMIT $1`, [
        this.options.batch ?? 100,
      ]);
      const done: string[] = [];
      let failure: Error | undefined;
      for (const row of rows) {
        try {
          await this.bus.send(parseEnvelope(row.event as string));
        } catch (err) {
          failure = err instanceof Error ? err : new Error(String(err));
          break;
        }
        done.push(String(row.seq));
      }
      // What went out is deleted also when a later one failed, so it is not sent twice.
      if (done.length > 0) {
        await c.query(`DELETE FROM ${this.rows} WHERE seq = ANY($1::bigint[])`, [done]);
      }
      if (rows.length === 0) await this.forget(c, tenant);
      return failure === undefined ? { count: done.length } : { count: done.length, failure };
    });
  }

  /**
   * Drops the tenant from the list once nothing is pending. A writer holding its row (see `list`)
   * keeps it listed until a later flush.
   */
  private async forget(c: SqlClient, tenant: string): Promise<void> {
    const held = await c.query(
      `SELECT 1 FROM ${this.tenants} WHERE tenant_id = $1 FOR UPDATE SKIP LOCKED`,
      [tenant],
    );
    if (held.rows.length === 0) return;
    const pending = await c.query(`SELECT EXISTS (SELECT 1 FROM ${this.rows}) AS any`);
    if (pending.rows[0]?.any !== true) {
      await c.query(`DELETE FROM ${this.tenants} WHERE tenant_id = $1`, [tenant]);
    }
  }

  /** Flushes every listed tenant; returns how many events went out. A module runs it on a timer. */
  async flushAll(): Promise<number> {
    const tenants = await this.db.global(async (c) =>
      (await c.query(`SELECT tenant_id FROM ${this.tenants} ORDER BY 1`)).rows.map(
        (r) => r.tenant_id as string,
      ),
    );
    let sent = 0;
    for (const tenant of tenants) sent += await this.flush(tenant);
    return sent;
  }
}
