// The bundle store in the shared files volume (contracts/screen.md, Pins; plan #109 S4): each
// container copies its own version in at start, and the store keeps the last 5 versions and every
// one an event's pin names or a timed pin restores, so a pinned screen never loses its files.
import { mkdir, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BundleStore, bundlesDir } from "../src/pins/bundles.js";
import { keepBundles } from "../src/pins/store.js";
import { DATABASE_URL, call, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

const NOON = Date.parse("2026-01-01T12:00:00Z");

describe.skipIf(!DATABASE_URL)("bundle store", () => {
  let h: Harness;
  let dir: string;
  const store = (current = "test") => new BundleStore({ dir, current, playerDir: h.playerDir });
  /** A version copied in `age` days ago. */
  const older = async (version: string, age: number) => {
    await mkdir(join(dir, version), { recursive: true });
    await writeFile(join(dir, version, "player.js"), `/* ${version} */\n`);
    await writeFile(join(dir, version, "player.css"), "body {}\n");
    const at = new Date(Date.now() - age * 86_400_000);
    await utimes(join(dir, version), at, at);
  };

  beforeAll(async () => {
    h = await harness();
    dir = bundlesDir(h.filesRoot);
  });
  afterAll(async () => {
    await h.close();
  });

  it("copies the platform's bundle in once, and lists every kept version newest first", async () => {
    await older("1.0.0", 3);
    await older("1.1.0", 2);
    const s = store();
    await s.install();
    expect(await readFile(join(dir, "test", "player.js"), "utf8")).toBe("export {};\n");
    expect(await readFile(join(dir, "test", "player.css"), "utf8")).toBe("body {}\n");
    await writeFile(join(dir, "test", "player.js"), "kept\n");
    await s.install();
    expect(await readFile(join(dir, "test", "player.js"), "utf8")).toBe("kept\n");
    expect(await s.available()).toEqual(["test", "1.1.0", "1.0.0"]);
    expect((await s.read("1.0.0", "player.js")).toString()).toBe("/* 1.0.0 */\n");
  });

  it("lists only names a version can have, and never a copy still in progress", async () => {
    await mkdir(join(dir, ".tmp-abc"), { recursive: true });
    await mkdir(join(dir, "bad name"), { recursive: true });
    const listed = await store().available();
    expect(listed).not.toContain(".tmp-abc");
    expect(listed).not.toContain("bad name");
    await expect(store().read("..", "player.js")).rejects.toMatchObject({ status: 404 });
    await expect(store().read("1.0.0", "sw.js")).rejects.toMatchObject({ status: 404 });
  });

  it("keeps the last 5 versions, the platform's own and every held one", async () => {
    for (const [i, v] of ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.6.0"].entries()) {
      await older(v, 20 - i);
    }
    const s = store();
    await s.prune(new Set(["0.1.0"]));
    const left = (await readdir(dir)).filter((n) => /^[0-9a-z]/.test(n) && !n.includes(" "));
    expect(left.sort()).toEqual(["0.1.0", "0.5.0", "0.6.0", "1.0.0", "1.1.0", "test"]);
  });

  it("holds what any event's pin names or its timed pin restores", async () => {
    await older("0.7.0", 40);
    await older("0.8.0", 41);
    await older("0.9.0", 42);
    const admin = { host: "alpha.test", session: "admin" };
    h.clock.now = NOON;
    h.sources.theme = null;
    expect(
      (
        await call(h, "PUT", "/api/screen/pin", {
          ...admin,
          body: { bundle_version: "0.7.0", theme_revision: null },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call(h, "PUT", "/api/screen/pin", {
          ...admin,
          body: {
            bundle_version: "0.8.0",
            theme_revision: null,
            until: new Date(NOON + 86_400_000).toISOString(),
          },
        })
      ).statusCode,
    ).toBe(200);
    const s = store();
    await keepBundles({ db: h.db, store: s });
    const left = await readdir(dir);
    expect(left).toContain("0.7.0");
    expect(left).toContain("0.8.0");
    expect(left).not.toContain("0.9.0");
    expect(left).toContain("test");
  });
});
