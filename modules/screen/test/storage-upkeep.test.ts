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
import { DATABASE_URL, call, harness, png, upload } from "./helpers.js";
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

describe("tenantsStorage", () => {
  it("gives up on a tenants that does not answer, so no lock waits on it for ever", async () => {
    const service = { headers: () => ({}) } as unknown as ServiceIdentity;
    const hung: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    const storage = tenantsStorage("http://tenants:8080", service, hung, 50);
    await expect(withTenant("alpha", () => storage.release(1))).rejects.toMatchObject({
      code: "tenants_unavailable",
    });
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

  it("counts a delete's bytes until tenants has them back, so a recount between is not low", async () => {
    const deck = await upload(h, "/api/screen/assets", pdfPages(5), "Gone.pdf", {
      session: "admin",
    });
    const id = deck.json<{ id: string }>().id;
    await h.pool.query<Record<string, string>>(
      "UPDATE screen_render_jobs SET state = 'succeeded', bytes = 40 WHERE asset_id = $1",
      [id],
    );
    // Every release stalls on its way to tenants; a recount runs meanwhile.
    const release = h.quota.release.bind(h.quota);
    let reached!: () => void;
    const releasing = new Promise<void>((resolve) => (reached = resolve));
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => (resume = resolve));
    h.quota.release = async (bytes) => {
      reached();
      await gate;
      await release(bytes);
    };
    try {
      const deleting = call(h, "DELETE", `/api/screen/assets/${id}`, {
        host: "alpha.test",
        session: "admin",
      });
      await releasing;
      const counting = inAlpha(() => recount(deps()));
      await new Promise((resolve) => setTimeout(resolve, 150));
      resume();
      expect((await deleting).statusCode).toBe(204);
      await counting;
    } finally {
      h.quota.release = release;
    }
    const raced = h.storage.used.alpha;
    await inAlpha(() => recount(deps()));
    expect(raced).toBe(h.storage.used.alpha);
  });

  it("gives nothing back when a delete rolls back after its render was dropped", async () => {
    const deck = await upload(h, "/api/screen/assets", pdfPages(6), "Kept.pdf", {
      session: "admin",
    });
    const id = deck.json<{ id: string }>().id;
    await h.pool.query<Record<string, string>>(
      "UPDATE screen_render_jobs SET state = 'succeeded', bytes = 40 WHERE asset_id = $1",
      [id],
    );
    const before = h.storage.used.alpha;
    const admin = { host: "alpha.test", session: "admin" };
    for (let i = 0; i < 2; i++) {
      h.failAudit.next = true;
      expect((await call(h, "DELETE", `/api/screen/assets/${id}`, admin)).statusCode).toBe(503);
    }
    expect(h.storage.used.alpha).toBe(before);
    const { rows } = await h.pool.query<Record<string, string>>(
      "SELECT 1 FROM screen_render_jobs WHERE asset_id = $1 AND state = 'succeeded'",
      [id],
    );
    expect(rows).toHaveLength(1);
    expect((await call(h, "DELETE", `/api/screen/assets/${id}`, admin)).statusCode).toBe(204);
  });

  it("counts a cancelled run's reservation until its container gives it back", async () => {
    const deck = await upload(h, "/api/screen/assets", pdfPages(7), "Stop.pdf", {
      session: "admin",
    });
    const id = deck.json<{ id: string }>().id;
    await inAlpha(() => recount(deps()));
    const clean = h.storage.used.alpha ?? 0;
    // The cancel route keeps reserved_bytes: the running container's settle gives them back.
    await h.pool.query<Record<string, string>>(
      "UPDATE screen_render_jobs SET state = 'cancelled', reserved_bytes = 70 WHERE asset_id = $1",
      [id],
    );
    await inAlpha(() => recount(deps()));
    expect(h.storage.used.alpha).toBe(clean + 70);
    await h.pool.query<Record<string, string>>(
      "UPDATE screen_render_jobs SET reserved_bytes = 0 WHERE asset_id = $1",
      [id],
    );
  });

  it("gives a rolled-back upload's bytes back before a recount can count without them", async () => {
    const first = await upload(h, "/api/screen/assets", await png(21), "a.png", {
      session: "admin",
    });
    const id = first.json<{ id: string }>().id;
    // The first transaction that fails stalls right after its rollback; a recount runs then.
    const tenant = h.db.tenant.bind(h.db);
    let rolledBack!: () => void;
    const stalled = new Promise<void>((resolve) => (rolledBack = resolve));
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => (resume = resolve));
    let armed = true;
    h.db.tenant = async (fn) => {
      try {
        return await tenant(fn);
      } catch (err) {
        if (armed) {
          armed = false;
          rolledBack();
          await gate;
        }
        throw err;
      }
    };
    try {
      // The replace places its file, then its audit fails: the transaction rolls back.
      h.failAudit.next = true;
      const replacing = upload(h, `/api/screen/assets/${id}/replace`, await png(22), "b.png", {
        session: "admin",
      });
      await stalled;
      await inAlpha(() => recount(deps()));
      resume();
      expect((await replacing).statusCode).toBe(503);
    } finally {
      h.db.tenant = tenant;
    }
    const raced = h.storage.used.alpha;
    await inAlpha(() => recount(deps()));
    expect(raced).toBe(h.storage.used.alpha);
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
