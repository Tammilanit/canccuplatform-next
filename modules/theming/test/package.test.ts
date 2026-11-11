/**
 * `PUT /api/theming/draft/package` (contracts/theming.md, The theme package): a zip replaces the
 * draft's content through the one write path, every file through its checks, the quota reserved;
 * a zip that breaks the archive rules leaves nothing behind.
 */
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { withTenant } from "@canccu/kit";
import { DATABASE_URL, code, get, send } from "./helpers.js";
import { draftFiles, png } from "./drafting.js";
import type { DraftBody } from "./drafting.js";
import { demoFiles, demoZip, putPackage } from "./packaging.js";
import { packageZip, rawZip } from "./zips.js";

const manifest = (extra: Record<string, unknown> = {}): string =>
  stringify({ schema_version: 1, name: "Test", mode: "advanced", tokens: {}, ...extra });

const layout = (regions: unknown[], id = "main"): Record<string, unknown> => ({
  id,
  name: "Main",
  aspect: "16:9",
  grid: { columns: 4, rows: 4 },
  regions,
});

const region = (id: string, widget: Record<string, unknown>, columns = 4) => ({
  id,
  area: { column: 1, row: 1, columns, rows: 4 },
  widgets: [widget],
});

describe.skipIf(!DATABASE_URL)("PUT /api/theming/draft/package", () => {
  const d = draftFiles();
  const { fresh, onDisk, storedBytes } = d;
  /** What the hourly recount sets (upkeep.ts): theme and embed files, each stored file once. */
  const counted = (): Promise<number> =>
    withTenant("alpha", () =>
      d.h.db.tenant(async (c) => {
        const { rows } = await c.query(
          `SELECT coalesce(sum(bytes), 0) AS n FROM (
             SELECT sha256 || '.' || ext AS name, bytes FROM theming_files
             UNION SELECT file, bytes FROM theming_embed_files) stored`,
        );
        return Number((rows[0] as { n: string }).n);
      }),
    );

  it("creates the draft from a zip when there is none, its files checked and counted", async () => {
    const res = await putPackage(d.h, await demoZip("default"));
    expect(res.statusCode).toBe(200);
    const body = res.json<DraftBody & { manifest: { name: string } }>();
    expect(body.draft_version).toBe(1);
    expect(body.manifest.name).toBe("Default");
    expect(body.files?.map((f) => f.path)).toEqual(["images/logo.svg"]);
    expect(body.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(d.h.storage.used.alpha).toBe(await storedBytes());
    // An existing draft is replaced only at its version.
    expect(code(await putPackage(d.h, await demoZip("default")))).toBe("version_conflict");
    expect(code(await putPackage(d.h, await demoZip("default"), { version: 7 }))).toBe(
      "version_conflict",
    );
  });

  it("replaces the draft's content, letting go of the files it no longer holds", async () => {
    const draft = await fresh();
    const first = packageZip({ "theme.yaml": manifest(), "images/a.png": await png("#ff0000") });
    const one = await putPackage(d.h, first, { version: draft.draft_version });
    expect(one.statusCode).toBe(200);
    expect(one.json<DraftBody>().draft_version).toBe(draft.draft_version + 1);
    const before = await onDisk();
    const second = packageZip({ "theme.yaml": manifest(), "images/b.png": await png("#00ff00") });
    const two = await putPackage(d.h, second, { version: draft.draft_version + 1 });
    expect(two.json<DraftBody>().files?.map((f) => f.path)).toEqual(["images/b.png"]);
    const after = await onDisk();
    expect(after).toHaveLength(before.length);
    expect(after).not.toEqual(before);
    expect(d.h.storage.used.alpha).toBe(await storedBytes());
  });

  it.each([
    ["a zip slip", rawZip([{ name: "../theme.yaml", data: Buffer.from(manifest()) }])],
    [
      "a symbolic link",
      rawZip([{ name: "images/a.svg", data: Buffer.from("/x"), mode: 0o120777 }]),
    ],
    ["a nested zip", rawZip([{ name: "images/a.png", data: packageZip({ a: "b" }) }])],
    [
      "a bomb by ratio",
      rawZip([{ name: "images/a.png", data: Buffer.alloc(4 << 20), deflate: true }]),
    ],
    ["no theme.yaml", packageZip({ "images/a.svg": "<svg/>" })],
    ["a file outside the folders", packageZip({ "theme.yaml": manifest(), "run.sh": "x" })],
    [
      "a path over the 136 characters a draft path holds",
      packageZip({ "theme.yaml": manifest(), [`templates/${"a".repeat(120)}.mustache`]: "x" }),
    ],
    ["a theme.yaml that is no YAML", packageZip({ "theme.yaml": "a: [" })],
  ])("refuses %s whole, leaving the draft as it was", async (_what, zip) => {
    const draft = await fresh();
    const res = await putPackage(d.h, zip, { version: draft.draft_version });
    expect(res.statusCode).toBe(400);
    expect(code(res)).toBe("package_refused");
    const now = await get(d.h, "/api/theming/draft", { session: "admin" });
    expect(now.json<DraftBody>().draft_version).toBe(draft.draft_version);
    expect(await onDisk()).toEqual([]);
  });

  it("refuses an archived event's upload", async () => {
    const res = await putPackage(d.h, await demoZip("default"), { host: "archived.test" });
    expect(code(res)).toBe("event_archived");
  });

  it("refuses a body over the package limit before reading it whole", async () => {
    const res = await putPackage(d.h, Buffer.alloc(22 * 1024 * 1024));
    expect(res.statusCode).toBe(413);
    expect(code(res)).toBe("too_large");
  });

  it("refuses a package that passes the storage quota, keeping nothing", async () => {
    d.h.storage.quota.alpha = 100;
    const res = await putPackage(
      d.h,
      packageZip({ "theme.yaml": manifest(), "images/a.png": await png("#123456", 64) }),
    );
    expect(res.statusCode).toBe(413);
    expect(code(res)).toBe("storage_quota_exceeded");
    expect(await onDisk()).toEqual([]);
    expect(d.h.storage.used.alpha ?? 0).toBe(0);
    expect((await get(d.h, "/api/theming/draft", { session: "admin" })).statusCode).toBe(404);
  });

  it("names each problem of the manifest and its files", async () => {
    const zip = packageZip({
      "theme.yaml": manifest({
        mode: "simple",
        brand: { primary: "#3b82f6", accent: "#f59e0b", scheme: "dark" },
        images: { logo: "images/logo.svg", hero: "images/hero.png" },
        fonts: [
          {
            family: "Exo 2",
            file: "fonts/exo.woff2",
            licence: "OFL-1.1",
            licence_file: "fonts/OFL.txt",
          },
        ],
        layouts: [
          layout([
            region("a", { widget: "clock", template: "nope" }),
            region("a", { widget: "hologram" }, 5),
          ]),
          layout([region("b", { widget: "logo" })]),
        ],
      }),
      "images/logo.svg": '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      "fonts/OFL.txt": "SIL Open Font License 1.1",
    });
    const res = await putPackage(d.h, zip);
    expect(res.statusCode).toBe(200);
    const problems = res.json<DraftBody>().problems.map((p) => `${p.code} ${p.path ?? ""}`);
    expect(problems).toEqual(
      expect.arrayContaining([
        "svg_forbidden images/logo.svg",
        "file_missing images/hero.png",
        "file_missing fonts/exo.woff2",
        "reference_unknown theme.yaml#/layouts/0/regions/0/widgets/0",
        "duplicate_id theme.yaml#/layouts/0/regions/1",
        "duplicate_id theme.yaml#/layouts/1",
        "area_outside_grid theme.yaml#/layouts/0/regions/1",
        "widget_unknown theme.yaml#/layouts/0/regions/1/widgets/0",
        "mode_mismatch theme.yaml#/fonts",
      ]),
    );
    expect(problems.filter((p) => p.startsWith("schema"))).toEqual([]);
  });

  it("puts a manifest that breaks the schema on the draft with its schema problems", async () => {
    const res = await putPackage(d.h, packageZip({ "theme.yaml": "name: 5\n" }));
    expect(res.statusCode).toBe(200);
    expect(res.json<DraftBody>().problems.some((p) => p.code === "schema")).toBe(true);
  });

  it("stores a font's licence for the package, and never serves it", async () => {
    const files = await demoFiles("terminal");
    const res = await putPackage(d.h, packageZip(files), { session: "embedder" });
    expect(res.statusCode).toBe(200);
    const body = res.json<DraftBody>();
    expect(body.files?.map((f) => f.path)).toContain("fonts/OFL.txt");
    const name = await d.fileAt("fonts/OFL.txt");
    expect(name).toMatch(/^[0-9a-f]{64}\.txt$/);
    expect(
      (await get(d.h, `/theming/draft/${String(name)}`, { session: "admin" })).statusCode,
    ).toBe(404);
    expect(body.problems.filter((p) => p.severity === "error")).toEqual([]);
    // A template's text is stored for the package and its export; surfaces get only its tree.
    const template = await d.fileAt("templates/clock-big.mustache");
    expect(template).toMatch(/^[0-9a-f]{64}\.mustache$/);
    expect(
      (await get(d.h, `/theming/draft/${String(template)}`, { session: "admin" })).statusCode,
    ).toBe(404);
  });

  describe("embeds", () => {
    const withEmbed = async (): Promise<Buffer> => {
      const files = await demoFiles("level-up");
      const kept = Object.entries(files).filter(([p]) => !/^(css|templates)\//.test(p));
      const parsed = parse(String(files["theme.yaml"])) as Record<string, unknown>;
      delete parsed.css;
      delete parsed.templates;
      parsed.layouts = [];
      return packageZip({ ...Object.fromEntries(kept), "theme.yaml": stringify(parsed) });
    };

    it("needs the embeds right to change them, is audited and counted", async () => {
      const zip = await withEmbed();
      const denied = await putPackage(d.h, zip, { session: "admin" });
      expect(denied.statusCode).toBe(403);
      const res = await putPackage(d.h, zip, { session: "embedder" });
      expect(res.statusCode).toBe(200);
      const body = res.json<DraftBody>();
      expect(body.problems.filter((p) => p.severity === "error")).toEqual([]);
      expect(body.files?.map((f) => f.path)).toEqual(
        expect.arrayContaining(["embeds/drift/index.html", "embeds/drift/drift.js"]),
      );
      expect(d.h.audit.at(-1)).toMatchObject({
        action: "theming.draft.embeds_changed",
        changes: { embeds: { old: [], new: ["drift"] } },
      });
      // The same embeds again change nothing: the theme right is enough.
      const again = await putPackage(d.h, zip, { session: "admin", version: 1 });
      expect(again.statusCode).toBe(200);
    });

    it("reserves an embed's bytes too, giving them back when the quota refuses", async () => {
      const zip = await withEmbed();
      const themeFiles = Object.entries(await demoFiles("level-up"))
        .filter(([p]) => /^(fonts|images)\//.test(p))
        .reduce((sum, [, b]) => sum + b.length, 0);
      // Room for the theme files, not for the embed's.
      d.h.storage.quota.alpha = themeFiles + 100;
      const res = await putPackage(d.h, zip, { session: "embedder" });
      expect(code(res)).toBe("storage_quota_exceeded");
      expect(d.h.storage.used.alpha ?? 0).toBe(0);
      expect(await onDisk()).toEqual([]);
    });

    it("counts an embed once over uploads, giving its bytes back when it goes", async () => {
      const zip = await withEmbed();
      expect((await putPackage(d.h, zip, { session: "embedder" })).statusCode).toBe(200);
      const once = await counted();
      expect(d.h.storage.used.alpha).toBe(once);
      // The same package again, then one without the embed, then the embed back and discarded.
      expect((await putPackage(d.h, zip, { session: "embedder", version: 1 })).statusCode).toBe(
        200,
      );
      expect(d.h.storage.used.alpha).toBe(once);
      const bare = packageZip({ "theme.yaml": manifest() });
      expect((await putPackage(d.h, bare, { session: "embedder", version: 2 })).statusCode).toBe(
        200,
      );
      expect(d.h.storage.used.alpha ?? 0).toBe(0);
      expect(await onDisk()).toEqual([]);
      expect((await putPackage(d.h, zip, { session: "embedder", version: 3 })).statusCode).toBe(
        200,
      );
      expect(d.h.storage.used.alpha).toBe(once);
      const discard = await send(d.h, "DELETE", "/api/theming/draft?draft_version=4", undefined);
      expect(discard.statusCode).toBe(204);
      expect(d.h.storage.used.alpha ?? 0).toBe(0);
      expect(await onDisk()).toEqual([]);
    });

    it("takes an unchanged embed back with the theme right alone, whatever its names' case", async () => {
      const zip = packageZip({
        "theme.yaml": manifest({
          embeds: {
            mixed: {
              entry: "embeds/mixed/index.html",
              files: ["embeds/mixed/Main.js", "embeds/mixed/app.css", "embeds/mixed/_x.json"],
            },
          },
        }),
        "embeds/mixed/index.html": "<!doctype html><title>x</title>",
        "embeds/mixed/Main.js": "export {};",
        "embeds/mixed/app.css": "body {}",
        "embeds/mixed/_x.json": "{}",
      });
      const first = await putPackage(d.h, zip, { session: "embedder" });
      expect(
        first.json<DraftBody>().files?.filter((f) => f.path.startsWith("embeds/")),
      ).toHaveLength(4);
      const audits = d.h.audit.length;
      const again = await putPackage(d.h, zip, { session: "admin", version: 1 });
      expect(again.statusCode).toBe(200);
      expect(d.h.audit).toHaveLength(audits);
    });

    it("names a declared embed's missing entry as an error, beside a stray file's warning", async () => {
      const zip = packageZip({
        "theme.yaml": manifest({ embeds: { clock: { entry: "embeds/clock/index.html" } } }),
        "embeds/clock/main.js": "export {};",
      });
      const res = await putPackage(d.h, zip, { session: "embedder" });
      expect(res.statusCode).toBe(200);
      expect(res.json<DraftBody>().problems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            code: "file_missing",
            path: "embeds/clock/index.html",
          }),
          expect.objectContaining({
            severity: "warning",
            code: "reference_unknown",
            path: "embeds/clock/main.js",
          }),
        ]),
      );
    });

    it("stores an embed with a failing file not at all, its problem naming why", async () => {
      const files = Object.fromEntries(
        Object.entries(await demoFiles("level-up")).filter(([p]) => !/^(css|templates)\//.test(p)),
      );
      files["embeds/drift/drift.js"] = Buffer.from([0xff, 0xfe, 0x00]);
      const res = await putPackage(d.h, packageZip(files), { session: "embedder" });
      const body = res.json<DraftBody>();
      expect(body.files?.some((f) => f.path.startsWith("embeds/"))).toBe(false);
      expect(body.problems.filter((p) => p.path?.startsWith("embeds/"))).toEqual([
        expect.objectContaining({ code: "file_type", path: "embeds/drift/drift.js" }),
      ]);
    });
  });
});
