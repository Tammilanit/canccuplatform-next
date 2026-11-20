/** The pizza app on a real Postgres (RLS needs one), with the bus in memory and fakes for the rest. */
import pg from "pg";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import {
  AdminClient,
  Bus,
  Outbox,
  RightsChecker,
  TenantResolver,
  createHealth,
  createLogger,
  runMigrations,
  withTenant,
} from "@canccu/kit";
import type { Event, SqlClient, TenantContext } from "@canccu/kit";
import { MemoryStreamStore, requireTestDatabase } from "@canccu/kit/testing";
import { buildApp } from "../src/app.js";
import type { AuditEntry } from "../src/audit.js";
import { MIGRATIONS_DIR, poolDb } from "../src/db.js";
import type { Db } from "../src/db.js";
import type { AppDeps } from "../src/http.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import type { PizzaSettings } from "../src/settings.js";
import { MANAGE, MENU_WRITE, OPEN, RECORD_READ } from "../src/policy.js";

/** Tests run only on a database named `*_test` (the harness refuses any other). */
export const DATABASE_URL = process.env.CANCCU_DATABASE_URL;

const TABLES = [
  "pizza_due",
  "pizza_crew",
  "pizza_pizzerias",
  "pizza_menu_entries",
  "pizza_orders",
  "pizza_items",
  "pizza_order_log",
  "pizza_idempotency",
  "pizza_outbox",
  "pizza_outbox_tenants",
  "pizza_tenants",
  "pizza_migrations",
];

/** Fresh tables, migrated by the module's own files as at start. */
export async function freshDatabase(): Promise<pg.Pool> {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  try {
    await requireTestDatabase(admin);
    await admin.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
    await runMigrations(admin, MIGRATIONS_DIR, { ledger: "pizza_migrations", lock: 5 });
  } finally {
    await admin.end();
  }
  // A party's worth of concurrent requests (the race tests) each hold a connection.
  return new pg.Pool({ connectionString: DATABASE_URL, max: 40 });
}

const ctx = (id: string, o: Partial<TenantContext> = {}): TenantContext => ({
  tenant_id: id,
  status: "live",
  primary_hostname: `${id}.test`,
  time_zone: "Europe/Helsinki",
  info_page_mode: "public",
  membership: "open",
  admin_access: "internet",
  venue: { id: "v_1", name: "Demo Hall", addresses: ["10.0.0.0/24"] },
  venue_ip_check: { enabled: true, disabled_until: null, reason: null },
  flags_version: 1,
  flags: {},
  ...o,
});

export const TENANTS: Record<string, TenantContext> = {
  "demo.test": ctx("demo"),
  "two.test": ctx("two"),
  "closed.test": ctx("closed", { info_page_mode: "sign_in" }),
  "venue.test": ctx("venue", { info_page_mode: "venue_only" }),
  "restricted.test": ctx("restricted", { admin_access: "restricted" }),
  "archived.test": ctx("archived", { status: "archived" }),
};

/** People by session id: the name is the id, capitalised; `outsider` is signed in but no member. */
const PEOPLE = ["pena", "anni", "mikko", "tero", "outsider"];
const RIGHTS: Record<string, string[]> = {
  crew: [MANAGE],
  opener: [OPEN],
  menus: [MENU_WRITE],
  treasurer: [RECORD_READ],
  admin: [MANAGE, OPEN, MENU_WRITE, RECORD_READ],
  organiser: [MANAGE, OPEN, MENU_WRITE, RECORD_READ, "admin.settings.read", "admin.settings.write"],
};
export const nameOf = (who: string) => who.charAt(0).toUpperCase() + who.slice(1);

function fakeTenants(url: string | URL | Request): Promise<Response> {
  const parsed = new URL(url instanceof Request ? url.url : url);
  const byId = /^\/internal\/tenants\/tenants\/([a-z0-9-]+)$/.exec(parsed.pathname)?.[1];
  const host = parsed.searchParams.get("host") ?? "";
  const found = byId ? Object.values(TENANTS).find((t) => t.tenant_id === byId) : TENANTS[host];
  return Promise.resolve(found ? Response.json(found) : new Response("{}", { status: 404 }));
}

function fakeAdmin(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const cookie = (init?.headers as Record<string, string> | undefined)?.cookie ?? "";
  const id = cookie.replace("canccu_session=", "");
  if (!PEOPLE.includes(id) && RIGHTS[id] === undefined && !/^p\d+$/.test(id)) {
    return Promise.resolve(
      Response.json({ error: { code: "not_signed_in", message: "no" } }, { status: 401 }),
    );
  }
  return Promise.resolve(
    Response.json({
      user: { id: `u_${id}`, name: nameOf(id) },
      rights: RIGHTS[id] ?? [],
      superadmin: false,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  );
}

/** Admin's settings API for the Food settings page: one event's pizza settings, versioned. */
export interface AdminSettings {
  values: Record<string, unknown>;
  version: number;
  writes: { host: string; values: Record<string, unknown> }[];
  /** Admin's status for a read instead of the settings, e.g. 404 or 503. */
  readStatus?: number;
}

function fakeAdminSettings(store: AdminSettings): AppDeps["admin"] {
  return {
    request: (method, path, o = {}) => {
      const id = (o.headers?.cookie ?? "").replace("canccu_session=", "");
      const rights = RIGHTS[id] ?? [];
      const status = (code: number, body: unknown) => Promise.resolve({ status: code, body });
      if (path !== "/api/admin/settings/pizza") return status(404, {});
      if (!rights.includes(method === "GET" ? "admin.settings.read" : "admin.settings.write"))
        return status(403, { error: { code: "missing_right", message: "needs a right" } });
      if (method === "GET" && store.readStatus !== undefined)
        return status(store.readStatus, { error: { code: "not_found", message: "no" } });
      if (method === "PUT") {
        const b = o.json as { settings_version: number; values: Record<string, unknown> };
        if (b.settings_version !== store.version)
          return status(409, { error: { code: "version_conflict", message: "stale" } });
        store.values = b.values;
        store.version += 1;
        store.writes.push({ host: o.headers?.host ?? "", values: b.values });
      }
      return status(200, {
        module: "pizza",
        values: store.values,
        settings_version: store.version,
        groups: [],
      });
    },
  };
}

export const T0 = new Date("2026-10-29T16:00:00Z"); // 18:00 in Helsinki, event day 2026-10-29

export const json = (r: LightMyRequestResponse): Record<string, unknown> =>
  r.json<Record<string, unknown>>();
export const errorOf = (r: LightMyRequestResponse): Record<string, unknown> =>
  (json(r).error ?? {}) as Record<string, unknown>;

export interface Call {
  host?: string;
  key?: string;
  ip?: string;
  contentType?: string;
  raw?: string;
}

export interface World {
  pool: pg.Pool;
  db: Db;
  app: FastifyInstance;
  store: MemoryStreamStore;
  audit: AuditEntry[];
  settings: Map<string, PizzaSettings>;
  languages: Map<string, string>;
  adminSettings: AdminSettings;
  now: Date;
  setNow(iso: string): void;
  advance(minutes: number): void;
  call(
    who: string | null,
    method: InjectOptions["method"],
    url: string,
    body?: unknown,
    o?: Call,
  ): Promise<LightMyRequestResponse>;
  /** The pizza events sent to an event's stream so far. */
  events(tenant?: string): Event[];
  tx<T>(tenant: string, fn: (c: SqlClient) => Promise<T>): Promise<T>;
  deps: AppDeps;
}

let keys = 0;

export async function world(pool: pg.Pool, o: Partial<AppDeps> = {}): Promise<World> {
  const db = poolDb(pool);
  const store = new MemoryStreamStore();
  const outbox = new Outbox(new Bus(store, "pizza"), db);
  const audit: AuditEntry[] = [];
  const settings = new Map<string, PizzaSettings>();
  const languages = new Map<string, string>();
  const adminSettings: AdminSettings = { values: {}, version: 1, writes: [] };
  const w = { now: T0 } as World;
  const deps: AppDeps = {
    db,
    admin: fakeAdminSettings(adminSettings),
    language: (tenant) => Promise.resolve(languages.get(tenant) ?? "en"),
    outbox,
    rights: new RightsChecker(new AdminClient("http://admin", { fetch: fakeAdmin })),
    tenants: new TenantResolver({ tenantsUrl: "http://tenants", fetch: fakeTenants }),
    audit: (e) => {
      audit.push(e);
      return Promise.resolve();
    },
    health: createHealth({ module: "pizza", version: "dev", checks: {} }),
    log: createLogger("pizza"),
    now: () => w.now,
    members: (_tenant, userId) => Promise.resolve(userId !== "u_outsider"),
    people: (userId) =>
      Promise.resolve({ discord_user_id: userId === "u_pena" ? "100000000000000001" : null }),
    settings: (tenant) => Promise.resolve(settings.get(tenant) ?? DEFAULT_SETTINGS),
    ...o,
  };
  const app = buildApp(deps);
  await app.ready();
  return Object.assign(w, {
    pool,
    db,
    app,
    store,
    audit,
    settings,
    languages,
    adminSettings,
    deps,
    setNow: (iso: string) => {
      w.now = new Date(iso);
    },
    advance: (minutes: number) => {
      w.now = new Date(w.now.getTime() + minutes * 60_000);
    },
    call: (
      who: string | null,
      method: InjectOptions["method"],
      url: string,
      body?: unknown,
      c: Call = {},
    ) => {
      keys += 1;
      const headers: Record<string, string> = { host: c.host ?? "demo.test" };
      if (who !== null) headers.cookie = `canccu_session=${who}`;
      if (method !== "GET")
        headers["idempotency-key"] = c.key ?? `test-key-${String(keys).padStart(6, "0")}`;
      if (c.raw !== undefined || body !== undefined)
        headers["content-type"] = c.contentType ?? "application/json";
      return app.inject({
        method: method ?? "GET",
        url,
        headers,
        ...(c.ip === undefined ? {} : { remoteAddress: c.ip }),
        ...(c.raw !== undefined
          ? { payload: c.raw }
          : body === undefined
            ? {}
            : { payload: JSON.stringify(body) }),
      });
    },
    events: (tenant = "demo") =>
      (store.streams.get(`t:${tenant}:events:pizza`) ?? []).map(
        ([, fields]) => JSON.parse(fields.event ?? "{}") as Event,
      ),
    tx: (tenant: string, fn: (c: SqlClient) => Promise<unknown>) =>
      withTenant(tenant, async () => {
        const out = await db.tenant(fn);
        await outbox.flush();
        return out;
      }),
  });
}

export const types = (events: Event[]): string[] => events.map((e) => e.type);

/** Two pizzerias on the demo event, through the API: Demo Pizzeria (menu, base, toppings) and Demo Grill. */
export async function seedPizzerias(
  w: World,
  host = "demo.test",
): Promise<{ pz: string; grill: string }> {
  const pz = json(
    await w.call(
      "menus",
      "POST",
      "/api/pizza/pizzerias",
      {
        name: "Demo Pizzeria",
        phone: "+000 000 0000",
        website: "https://pizzeria.example",
      },
      { host },
    ),
  ).id as string;
  await w.call(
    "menus",
    "PUT",
    `/api/pizza/pizzerias/${pz}/menu`,
    {
      base: { name: "Oma pizza", price: 700 },
      items: [
        { number: "1", name: "Margherita", description: "tomato, mozzarella", price: 800 },
        { number: "3", name: "Pepperoni", price: 900 },
        { number: "12", name: "Kebab", description: "kebab, onion, jalapeño", price: 950 },
        { number: "20", name: "Kinkku" },
      ],
      toppings: [
        { name: "kinkku", price: 100 },
        { name: "ananas", price: 100 },
      ],
    },
    { host },
  );
  const grill = json(
    await w.call(
      "menus",
      "POST",
      "/api/pizza/pizzerias",
      { name: "Demo Grill", service: "takeaway" },
      { host },
    ),
  ).id as string;
  await w.call(
    "menus",
    "PUT",
    `/api/pizza/pizzerias/${grill}/menu`,
    {
      items: [{ number: "1", name: "Demo Burger", price: 1000 }],
    },
    { host },
  );
  return { pz, grill };
}

/** The menu item id of a number at a pizzeria. */
export async function itemId(w: World, pizzeria: string, number: string): Promise<string> {
  const p = json(await w.call("pena", "GET", `/api/pizza/pizzerias/${pizzeria}`));
  const items = (p.menu as { items: { id: string; number: string }[] }).items;
  const hit = items.find((i) => i.number === number);
  if (hit === undefined) throw new Error(`no item ${number}`);
  return hit.id;
}

export const closesAt = (w: World, minutes = 60) =>
  new Date(w.now.getTime() + minutes * 60_000).toISOString();

/** Opens an order as `who` at a pizzeria; answers the response. */
export function open(
  w: World,
  who: string | null,
  pizzeria: string,
  extra: Record<string, unknown> = {},
) {
  return w.call(who, "POST", "/api/pizza/orders", {
    pizzeria_id: pizzeria,
    closes_at: closesAt(w),
    ...extra,
  });
}
