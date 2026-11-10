/**
 * The storage upkeep (contracts/tenants.md, Storage quota, Repair): the recount of screen's
 * bytes, the sweep of orphaned files and of stale render scratch directories, and its schedule.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tenantFile, withTenant } from "@canccu/kit";
import type { ServiceIdentity } from "@canccu/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { holdCount, tenantsStorage } from "../src/assets/storage.js";
import { recount, sweepFiles, upkeepAll } from "../src/assets/upkeep.js";
import { DATABASE_URL, harness, png, upload } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { pdfPages } from "./render-fake.js";

const ORPHAN = `${"ab".repeat(32)}.png`;

describe("tenantsStorage.repair", () => {
  it("puts screen's count on the repair path", async () => {
    const seen: { url: string; method: string; body: unknown }[] = [];
    const service = { headers: () => ({ "x-test": "1" }) } as unknown as ServiceIdentity;
    const storage = tenantsStorage("http://tenants:8080/", service, (url, init) => {
      seen.push({
        url: url as string,
        method: init?.method ?? "",
        body: JSON.parse(init?.body as string) as unknown,
      });
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    await withTenant("alpha", () => storage.repair(42));
    expect(seen).toEqual([
      {
        url: "http://tenants:8080/internal/tenants/storage/modules/screen?tenant_id=alpha",
        method: "PUT",
        body: { bytes: 42 },
      },
    ]);
  });
});

describe.skipIf(!DATABASE_URL)("storage upkeep", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });

  const fileBytes = async () =>
    Number(
      (
        await h.pool.query<Record<string, string>>(
          "SELECT COALESCE(SUM(size_bytes), 0) AS n FROM screen_files WHERE tenant_id = 'alpha'",
        )
      ).rows[0]?.n,
    );
  const inAlpha = <T>(fn: () => Promise<T>) => withTenant("alpha", fn);
  const deps = () => ({ db: h.db, storage: h.quota, filesRoot: h.filesRoot });

  it("sets the count to the files, the renders and the running jobs' reservations", async () => {
    const res = await upload(h, "/api/screen/assets", await png(7), "a.png", { session: "admin" });
    expect(res.statusCode).toBe(201);
    const deck = await upload(h, "/api/screen/assets", pdfPages(3), "Deck.pdf", {
      session: "admin",
    });
    expect(deck.statusCode).toBe(201);
    await h.pool.query<Record<string, string>>(
      "UPDATE screen_render_jobs SET state = 'running', reserved_bytes = 100 WHERE tenant_id = 'alpha'",
    );
    h.storage.used.alpha = 999_999;
    await inAlpha(() => recount(deps()));
    expect(h.storage.used.alpha).toBe((await fileBytes()) + 100);
    await h.pool.query<Record<string, string>>(
      "UPDATE screen_render_jobs SET state = 'succeeded', reserved_bytes = 0, bytes = 30 WHERE tenant_id = 'alpha'",
    );
    await inAlpha(() => recount(deps()));
    expect(h.storage.used.alpha).toBe((await fileBytes()) + 30);
  });

  it("waits for an upload's open reservation, so its bytes are not lost from the count", async () => {
    const base = await fileBytes();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const uploadTx = inAlpha(() =>
      h.db.tenant(async (c) => {
        await holdCount(c);
        await h.quota.reserve(50);
        held();
        await gate;
        await c.query(
          "INSERT INTO screen_files (name, mime_type, size_bytes) VALUES ($1, 'image/png', 50)",
          [`${"cd".repeat(32)}.png`],
        );
      }),
    );
    await holding;
    let done = false;
    const counting = inAlpha(() => recount(deps())).then(() => (done = true));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(done).toBe(false);
    release();
    await uploadTx;
    await counting;
    expect(h.storage.used.alpha).toBe(base + 50 + 30);
  });

  it("sweeps orphaned files and stale render scratch, and keeps what is in use", async () => {
    const files = await inAlpha(() => Promise.resolve(tenantFile("screen", "files", h.filesRoot)));
    const tmp = await inAlpha(() => Promise.resolve(tenantFile("screen", "tmp", h.filesRoot)));
    await writeFile(join(files, ORPHAN), "lost");
    await writeFile(join(files, "notes.txt"), "not a stored file");
    const { rows } = await h.pool.query<Record<string, string>>(
      "SELECT name FROM screen_files WHERE tenant_id = 'alpha' ORDER BY name LIMIT 1",
    );
    const kept = rows[0]?.name ?? "";
    const job =
      (
        await h.pool.query<Record<string, string>>(
          "SELECT id FROM screen_render_jobs WHERE tenant_id = 'alpha' LIMIT 1",
        )
      ).rows[0]?.id ?? "";
    await h.pool.query<Record<string, string>>(
      "UPDATE screen_render_jobs SET state = 'running', attempts = 2 WHERE id = $1",
      [job],
    );
    for (const dir of [`render-${job}-2`, `render-${job}-1`, "render-gone-job-1"]) {
      await mkdir(join(tmp, dir), { recursive: true });
      await writeFile(join(tmp, dir, "slide-1.png"), "x");
    }
    await inAlpha(() => sweepFiles(deps()));
    expect(existsSync(join(files, ORPHAN))).toBe(false);
    expect(existsSync(join(files, kept))).toBe(true);
    expect(existsSync(join(files, "notes.txt"))).toBe(true);
    expect(existsSync(join(tmp, `render-${job}-2`))).toBe(true);
    expect(existsSync(join(tmp, `render-${job}-1`))).toBe(false);
    expect(existsSync(join(tmp, "render-gone-job-1"))).toBe(false);
  });

  it("runs each event's upkeep once per period, across containers", async () => {
    h.storage.used.alpha = 1;
    const run = () => upkeepAll({ ...deps(), kv: h.kv, periodMs: 3_600_000 });
    await run();
    const counted = h.storage.used.alpha;
    expect(counted).toBeGreaterThan(1);
    h.storage.used.alpha = 1;
    await run();
    expect(h.storage.used.alpha).toBe(1);
    h.clock.now += 3_600_001;
    await run();
    expect(h.storage.used.alpha).toBe(counted);
  });
});
