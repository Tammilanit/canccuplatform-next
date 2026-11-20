/** The engine on a real Postgres (RLS needs one), with the bus in memory and a clock the test moves. */
import pg from "pg";
import { Bus, Outbox, runMigrations, withTenant } from "@canccu/kit";
import type { Event, SqlClient } from "@canccu/kit";
import { MemoryStreamStore, requireTestDatabase } from "@canccu/kit/testing";
import { MIGRATIONS_DIR, poolDb } from "../src/db.js";
import type { Db } from "../src/db.js";
import { Engine } from "../src/engine.js";
import { Cues } from "../src/cues/service.js";
import type { Counters } from "../src/cues/counters.js";
import type { ScreenClient, ZoneSoundStatus } from "../src/cues/screen.js";
import { noteTenant } from "../src/tick.js";

/** Tests run only on a database named `*_test` (the harness refuses any other). */
export const DATABASE_URL = process.env.CANCCU_DATABASE_URL;

const TABLES = [
  "moments",
  "moment_overrides",
  "moment_placements",
  "moments_zones",
  "moments_priorities",
  "moments_rules",
  "moments_sources",
  "moments_history",
  "moments_idempotency",
  "moments_outbox",
  "moments_sound_settings",
  "moments_cues",
  "moments_sounds",
  "moments_sound_zones",
  "moments_sound_sources",
  "moments_sound_log",
  "moments_scenes",
  "moments_scene_zones",
  "moments_scene_crew",
  "moments_checkins",
  "moments_announcements",
  "moments_announcement_templates",
  "moments_stories",
  "moments_story_runs",
  "moments_story_marks",
  "moments_rule_retries",
  "moments_claims_marks",
  "moments_outbox_tenants",
  "moments_tenants",
  "moments_migrations",
];

/** Fresh tables, migrated by the module's own files as at start. */
export async function freshDatabase(): Promise<pg.Pool> {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  try {
    await requireTestDatabase(admin);
    await admin.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
    await runMigrations(admin, MIGRATIONS_DIR, { ledger: "moments_migrations", lock: 3 });
  } finally {
    await admin.end();
  }
  return new pg.Pool({ connectionString: DATABASE_URL });
}

export interface World {
  pool: pg.Pool;
  db: Db;
  store: MemoryStreamStore;
  outbox: Outbox;
  engine: Engine;
  /** The test's clock. */
  now: Date;
  at(seconds: number): Date;
  /** Runs `fn` in one tenant transaction, then sends the outbox, as a request does. */
  tx<T>(tenant: string, fn: (c: SqlClient) => Promise<T>): Promise<T>;
  /** The moments events sent to one event's stream so far. */
  events(tenant: string): Event[];
  /** A new engine on the same database: what a restarted container is. */
  restart(): void;
  cues: Cues;
  /** What the fake Screen says of each zone's sound; a zone not set has `soundScreen`, lively. */
  zoneStatus: Map<string, ZoneSoundStatus>;
  soundScreen: NonNullable<ZoneSoundStatus["device"]>;
  screen: ScreenClient;
  /** Audio assets the fake Screen holds, by id. */
  assets: Map<string, Awaited<ReturnType<ScreenClient["asset"]>>>;
  /** The event's images the fake Screen holds, newest first, with their bytes. */
  images: { id: string; title: string; url: string; type: string; body: Buffer }[];
  /** The zones' names the fake Screen gives, by key; a zone not set has none. */
  zoneNames: Map<string, string>;
  counters: MemoryCounters;
}

/** Valkey's counters and claims in memory; their keys name their minute, hour or event, so none expires. */
export class MemoryCounters implements Counters {
  readonly values = new Map<string, number>();
  /** Valkey down: every call fails, as the client's do once its retries are spent. */
  down = false;
  get(keys: string[]): Promise<number[]> {
    if (this.down) return Promise.reject(new Error("Connection is closed."));
    return Promise.resolve(keys.map((k) => this.values.get(k) ?? 0));
  }
  incr(key: string): Promise<number> {
    if (this.down) return Promise.reject(new Error("Connection is closed."));
    const n = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, n);
    return Promise.resolve(n);
  }
  readonly claims = new Map<string, string>();
  claim(key: string, owner: string): Promise<boolean> {
    if (this.down) return Promise.reject(new Error("Connection is closed."));
    const held = this.claims.get(key) ?? owner;
    this.claims.set(key, held);
    return Promise.resolve(held === owner);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

export const T0 = new Date("2026-01-01T18:00:00Z");

export function world(pool: pg.Pool): World {
  const db = poolDb(pool);
  const store = new MemoryStreamStore();
  const zoneStatus = new Map<string, ZoneSoundStatus>();
  const soundScreen = {
    id: "dv_sound",
    name: "Main hall sound",
    online: true,
    audio_unlocked: true,
  };
  const assets: World["assets"] = new Map();
  const images: World["images"] = [];
  const zoneNames: World["zoneNames"] = new Map();
  const screen: ScreenClient = {
    zones: () => Promise.resolve([...zoneNames].map(([key, name]) => ({ key, name }))),
    zoneSound: (_tenant, zone) =>
      Promise.resolve(zoneStatus.get(zone) ?? { energy: "lively", device: soundScreen }),
    asset: (_tenant, id) => Promise.resolve(assets.get(id) ?? null),
    images: () => Promise.resolve(images.map(({ id, title, url }) => ({ id, title, url }))),
    image: (_tenant, id) => {
      const i = images.find((x) => x.id === id);
      return Promise.resolve(i === undefined ? null : { type: i.type, body: i.body });
    },
  };
  const counters = new MemoryCounters();
  const make = () => {
    const outbox = new Outbox(new Bus(store, "moments"), db);
    const cues = new Cues({
      outbox,
      counters,
      screen,
      random: () => 0,
    });
    return { outbox, cues, engine: new Engine(outbox, cues) };
  };
  let parts = make();
  const w: World = {
    pool,
    db,
    store,
    get outbox() {
      return parts.outbox;
    },
    get engine() {
      return parts.engine;
    },
    get cues() {
      return parts.cues;
    },
    zoneStatus,
    soundScreen,
    assets,
    images,
    zoneNames,
    screen,
    counters,
    now: T0,
    at: (s) => new Date(T0.getTime() + s * 1000),
    tx: (tenant, fn) =>
      withTenant(tenant, async () => {
        await noteTenant(db, tenant);
        const out = await db.tenant(fn);
        await parts.outbox.flush();
        return out;
      }),
    events: (tenant) =>
      (store.streams.get(`t:${tenant}:events:moments`) ?? []).map(
        ([, fields]) => JSON.parse(fields.event ?? "{}") as Event,
      ),
    restart: () => {
      parts = make();
    },
  };
  return w;
}

/** A report as Screen sends it in `screen.claims.changed`. */
export function claims(
  zone: string,
  placed: [string, string][],
  unplaced: string[] = [],
  hidden: string[] = [],
) {
  return {
    zone_key: zone,
    placed: placed.map(([override_id, role]) => ({ override_id, role })),
    unplaced,
    hidden,
  };
}

export const types = (events: Event[]): string[] => events.map((e) => e.type);
