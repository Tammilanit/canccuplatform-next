// The pins tests' shared setup (pins.test.ts, pins-until.test.ts): a harness with an old bundle
// kept, theme revisions 3 to 5, a paired device and the pin tick, plus the calls the tests make.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Outbox, withTenant } from "@canccu/kit";
import type { LightMyRequestResponse } from "fastify";
import { takeCommands } from "../src/assignments.js";
import type { ThemeNow } from "../src/compose/sources.js";
import { BundleStore, bundlesDir } from "../src/pins/bundles.js";
import { pinTickRunner } from "../src/pins/tick.js";
import { TENANTS, call, events, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

export const as = (session: string, body?: unknown, host = "alpha.test") => ({
  host,
  session,
  body,
});
export const DAY = 24 * 3600_000;
// The harness's clock starts at 2026-01-01T12:00:00Z.
export const NOON = Date.parse("2026-01-01T12:00:00Z");
export const iso = (ms: number) => new Date(ms).toISOString();

export const theme = (revision: number): ThemeNow => ({
  revision,
  tokens_css_url: `/theming/r/${revision}/tokens.css`,
  css_url: null,
  logo_url: null,
  layouts: [],
  templates: [],
});

export interface Pins {
  h: Harness;
  tick: () => Promise<void>;
  device: string;
  token: string;
  changes: (tenant?: string) => Record<string, unknown>[];
  pin: (session?: string, host?: string) => Promise<Record<string, unknown>>;
  put: (body: unknown, session?: string, host?: string) => Promise<LightMyRequestResponse>;
  commands: () => Promise<string[]>;
  /** Back to noon, unpinned, with no command waiting and no audit: each test starts here. */
  reset: () => Promise<void>;
}

export async function pinsHarness(): Promise<Pins> {
  const h = await harness();
  const { id: device, token } = await pairDevice(h);
  const dir = join(bundlesDir(h.filesRoot), "0.9.0");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "player.js"), "/* 0.9.0 */\n");
  await writeFile(join(dir, "player.css"), "body {}\n");
  h.sources.theme = theme(5);
  h.sources.revisions = { 3: theme(3), 4: theme(4), 5: theme(5) };
  h.publicEvents["alpha.test"] = {
    id: "alpha",
    status: "live",
    ends_at: iso(NOON + 3 * DAY),
  };
  const tick = pinTickRunner({
    db: h.db,
    kv: h.kv,
    outbox: new Outbox(h.bus, h.db),
    audit: (entry) => {
      h.audits.push(entry);
      return Promise.resolve();
    },
    sources: {
      themeRevision: (_t, n) =>
        Promise.resolve(h.sources.revisionsDown ? null : (h.sources.revisions[n] ?? "gone")),
    },
    bundles: new BundleStore({
      dir: bundlesDir(h.filesRoot),
      current: "test",
      playerDir: h.playerDir,
    }),
    fanout: { publish: () => Promise.resolve() },
    tenantById: (id) =>
      Promise.resolve(Object.values(TENANTS).find((t) => t.tenant_id === id) ?? null),
    now: () => h.clock.now,
  });
  const put: Pins["put"] = (body, session = "admin", host = "alpha.test") =>
    call(h, "PUT", "/api/screen/pin", as(session, body, host));
  const commands = () =>
    withTenant("alpha", () => takeCommands(h.kv, device, h.clock.now)).then((list) =>
      list.map((c) => c.command),
    );
  return {
    h,
    tick,
    device,
    token,
    changes: (tenant = "alpha") => events(h, "screen.pin.changed", tenant),
    pin: async (session = "admin", host = "alpha.test") =>
      (await call(h, "GET", "/api/screen/pin", as(session, undefined, host))).json<
        Record<string, unknown>
      >(),
    put,
    commands,
    reset: async () => {
      h.clock.now = NOON;
      await put({ bundle_version: null, theme_revision: null });
      await commands();
      h.audits.length = 0;
    },
  };
}
