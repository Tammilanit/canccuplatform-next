/** The storage quota's client (contracts/tenants.md, Storage quota), shared by every module that keeps files. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ServiceIdentity, tenantsStorage, tenantsWithFiles, withTenant } from "../src/index.js";

const service = new ServiceIdentity({ module: "theming", key: "k".repeat(32) });

interface Seen {
  url: string;
  method: string;
  body: unknown;
  service: boolean;
}

function recording(status = 200, answer: unknown = {}): { seen: Seen[]; fetch: typeof fetch } {
  const seen: Seen[] = [];
  const fetchFn: typeof fetch = (url, init) => {
    const headers = init?.headers as Record<string, string>;
    seen.push({
      url: url as string,
      method: init?.method ?? "",
      body: JSON.parse(init?.body as string) as unknown,
      service: Object.keys(headers).some((h) => h.startsWith("x-canccu-service")),
    });
    return Promise.resolve(Response.json(answer, { status }));
  };
  return { seen, fetch: fetchFn };
}

describe("tenantsStorage", () => {
  it("reserves and releases for the calling module, as its service identity", async () => {
    const r = recording();
    const storage = tenantsStorage("http://tenants:8080/", service, r.fetch);
    await withTenant("alpha", async () => {
      await storage.reserve(10);
      await storage.release(4);
    });
    expect(r.seen).toEqual([
      {
        url: "http://tenants:8080/internal/tenants/storage/reserve?tenant_id=alpha",
        method: "POST",
        body: { module: "theming", bytes: 10 },
        service: true,
      },
      {
        url: "http://tenants:8080/internal/tenants/storage/release?tenant_id=alpha",
        method: "POST",
        body: { module: "theming", bytes: 4 },
        service: true,
      },
    ]);
  });

  it("names the module it counts for, which keys its count locks", () => {
    expect(tenantsStorage("http://tenants", service).module).toBe("theming");
  });

  it("puts the module's count on the repair path", async () => {
    const r = recording();
    const storage = tenantsStorage("http://tenants:8080", service, r.fetch);
    await withTenant("alpha", () => storage.repair(42));
    expect(r.seen).toMatchObject([
      {
        url: "http://tenants:8080/internal/tenants/storage/modules/theming?tenant_id=alpha",
        method: "PUT",
        body: { bytes: 42 },
      },
    ]);
  });

  it("passes the quota's refusal on unchanged", async () => {
    const error = { code: "storage_quota_exceeded", message: "Over the quota." };
    const storage = tenantsStorage("http://tenants", service, recording(413, { error }).fetch);
    await expect(withTenant("alpha", () => storage.reserve(1))).rejects.toMatchObject({
      status: 413,
      code: "storage_quota_exceeded",
      message: "Over the quota.",
    });
  });

  it("answers 503 for any other failure, so no write goes on without a reserve", async () => {
    const storage = tenantsStorage("http://tenants", service, recording(500).fetch);
    await expect(withTenant("alpha", () => storage.reserve(1))).rejects.toMatchObject({
      status: 503,
      code: "tenants_unavailable",
    });
  });

  it("gives up on a tenants that does not answer, so no lock waits on it for ever", async () => {
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

describe("tenantsWithFiles", () => {
  it("lists the events with files of the module, never `_platform` or an empty folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "canccu-kit-files-"));
    try {
      await mkdir(join(root, "alpha", "theming", "files"), { recursive: true });
      await mkdir(join(root, "beta", "theming"), { recursive: true });
      await mkdir(join(root, "gamma", "screen", "files"), { recursive: true });
      await mkdir(join(root, "_platform", "theming", "files"), { recursive: true });
      await writeFile(join(root, "stray"), "");
      expect(await tenantsWithFiles(root, "theming")).toEqual(["alpha"]);
      expect(await tenantsWithFiles(join(root, "missing"), "theming")).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
