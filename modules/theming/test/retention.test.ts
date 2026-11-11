/**
 * Kept revisions (contracts/theming.md, Draft, preview, publish, Kept; plan D12): the newest 20
 * plus every revision a screen pins or a timed pin will restore, learnt from `screen.pin.changed`
 * and read again from the stream at start; the files only pruned revisions used go, their bytes
 * given back.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Bus, createLogger, tenantFile, withTenant } from "@canccu/kit";
import { beforeEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { putEmbed } from "../src/embeds.js";
import { listenPins, pinHandler } from "../src/pins.js";
import { pruneRevisions } from "../src/retention.js";
import { DATABASE_URL, caller, get, send } from "./helpers.js";
import { draftFiles } from "./drafting.js";
import type { DraftBody } from "./drafting.js";
import { putPackage } from "./packaging.js";
import { packageZip } from "./zips.js";

const log = createLogger("theming");

describe.skipIf(!DATABASE_URL)("retention and pins", () => {
  const d = draftFiles();
  const deps = () => ({ db: d.h.db, files: d.h.files, storage: d.h.quota, log });
  const inAlpha = <T>(fn: () => Promise<T>): Promise<T> => withTenant("alpha", fn);

  beforeEach(async () => {
    for (const tenant of ["alpha", "beta"]) {
      await withTenant(tenant, () => d.h.db.tenant((c) => c.query(`DELETE FROM theming_pins`)));
    }
    d.h.store.streams.clear();
  });

  /** Publishes a revision whose CSS no other revision holds; answers its number. */
  async function publish(n: number): Promise<number> {
    const zip = packageZip({
      "theme.yaml": stringify({
        schema_version: 1,
        name: `Revision ${String(n)}`,
        mode: "advanced",
        tokens: {},
        css: ["css/theme.css"],
      }),
      "css/theme.css": `.t-r${String(n)} { color: red; }`,
    });
    const draft = (await putPackage(d.h, zip)).json<DraftBody>();
    const res = await send(d.h, "POST", "/api/theming/draft/publish", {
      draft_version: draft.draft_version,
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ revision: number }>().revision;
  }

  /** The stored files only `revision` refers to, among the ones it refers to. */
  const filesOf = (revision: number): Promise<string[]> =>
    inAlpha(() =>
      d.h.db.tenant(async (c) => {
        const { rows } = await c.query(
          `SELECT file FROM theming_file_refs f WHERE owner = $1
              AND NOT EXISTS (SELECT 1 FROM theming_file_refs o WHERE o.file = f.file AND o.owner <> $1)`,
          [`r:${String(revision)}`],
        );
        return (rows as { file: string }[]).map((r) => r.file);
      }),
    );

  const onDisk = (file: string): Promise<boolean> =>
    inAlpha(() =>
      Promise.resolve(existsSync(join(tenantFile("theming", "files", d.h.root), file))),
    );

  const kept = async (): Promise<number[]> => {
    const res = await get(d.h, "/api/theming/revisions?limit=100", { session: "admin" });
    return res
      .json<{ revisions: { revision: number }[] }>()
      .revisions.map((r) => r.revision)
      .sort((a, b) => a - b);
  };

  /** screen.pin.changed as the screen module emits it, handled as theming's listener would. */
  async function pin(
    theme: number | null,
    restores: number | null,
    time = new Date().toISOString(),
    reason = "set",
  ): Promise<void> {
    await inAlpha(() =>
      pinHandler(deps())({
        id: `01928f3e-7a2b-7c4d-9e8f-${String(Date.now()).padStart(12, "0")}`,
        type: "screen.pin.changed",
        version: 1,
        time,
        source: "screen",
        tenant: "alpha",
        data: {
          bundle_version: null,
          theme_revision: theme,
          until: restores === null ? null : "2099-01-01T00:00:00Z",
          restores: restores === null ? null : { bundle_version: null, theme_revision: restores },
          reason,
          actor_user_id: reason === "expired" ? null : "u_admin",
        },
      }),
    );
  }

  it("keeps the newest 20, deleting the others and the files only they used, bytes given back", async () => {
    for (let n = 1; n <= 20; n += 1) await publish(n);
    const only = await filesOf(1);
    expect(only.length).toBeGreaterThan(0);
    const usedBefore = d.h.storage.used.alpha ?? 0;

    await publish(21);
    expect(await kept()).toEqual(Array.from({ length: 20 }, (_, i) => i + 2));
    expect((await get(d.h, "/api/theming/revisions/1", { session: "admin" })).statusCode).toBe(404);
    const internal = await d.h.app.inject({
      method: "GET",
      url: "/internal/theming/revisions/1?tenant_id=alpha",
      headers: caller("screen"),
    });
    expect(internal.statusCode).toBe(404);
    for (const file of only) expect(await onDisk(file)).toBe(false);
    expect(d.h.storage.used.alpha ?? 0).toBeLessThan(usedBefore);
    const rows = await inAlpha(() =>
      d.h.db.tenant(async (c) => {
        const { rows: left } = await c.query(
          `SELECT owner FROM theming_file_refs WHERE owner = 'r:1'
           UNION ALL SELECT owner FROM theming_package_files WHERE owner = 'r:1'
           UNION ALL SELECT sha256 FROM theming_files
            WHERE sha256 || '.' || ext = ANY($1::text[])`,
          [only],
        );
        return left;
      }),
    );
    expect(rows).toEqual([]);
    // A restore from the oldest kept revision still finds its files.
    const restored = await send(d.h, "POST", "/api/theming/revisions/2/restore", {
      current_revision: 21,
    });
    expect(restored.statusCode).toBe(201);
    expect(await kept()).toEqual(Array.from({ length: 20 }, (_, i) => i + 3));
  });

  it("keeps a pinned revision and the one a timed pin restores, and lets them go when unpinned", async () => {
    await publish(1);
    await publish(2);
    await pin(1, 2);
    for (let n = 3; n <= 23; n += 1) await publish(n);
    const list = await get(d.h, "/api/theming/revisions?limit=100", { session: "admin" });
    const revisions = list.json<{ revisions: { revision: number; pinned: boolean }[] }>().revisions;
    expect(revisions.map((r) => r.revision).sort((a, b) => a - b)).toEqual([
      1,
      2,
      ...Array.from({ length: 20 }, (_, i) => i + 4),
    ]);
    expect(revisions.filter((r) => r.pinned).map((r) => r.revision)).toEqual([2, 1]);
    // The pinned revision stays readable for the screen module.
    const internal = await d.h.app.inject({
      method: "GET",
      url: "/internal/theming/revisions/1?tenant_id=alpha",
      headers: caller("screen"),
    });
    expect(internal.statusCode).toBe(200);

    // At `until` the screen puts revision 2 back as a pin without an end: 1 is no longer kept.
    await pin(2, null, undefined, "expired");
    expect((await kept())[0]).toBe(2);
    expect(await kept()).not.toContain(1);
    // Cleared: 2 goes too.
    await pin(null, null, undefined, "cleared");
    expect(await kept()).toEqual(Array.from({ length: 20 }, (_, i) => i + 4));
  });

  it("never lets an older pin event replace the one it holds", async () => {
    await publish(1);
    await pin(1, null, "2026-01-01T10:00:00.000Z");
    await pin(null, null, "2026-01-01T09:00:00.000Z", "cleared");
    const row = await inAlpha(() =>
      d.h.db.tenant(async (c) => (await c.query(`SELECT theme_revision FROM theming_pins`)).rows),
    );
    expect(row).toEqual([{ theme_revision: 1 }]);
  });

  it("ignores a malformed pin event", async () => {
    await publish(1);
    await inAlpha(() =>
      pinHandler(deps())({
        id: "01928f3e-7a2b-7c4d-9e8f-000000000001",
        type: "screen.pin.changed",
        version: 1,
        time: new Date().toISOString(),
        source: "screen",
        tenant: "alpha",
        data: { theme_revision: "1", restores: "no" },
      }),
    );
    const rows = await inAlpha(() =>
      d.h.db.tenant(async (c) => (await c.query(`SELECT * FROM theming_pins`)).rows),
    );
    expect(rows).toEqual([]);
  });

  it("reads the pin events already in the stream at start", async () => {
    await publish(1);
    const screen = new Bus(d.h.store, "screen");
    await inAlpha(() =>
      screen.publish(
        "screen.pin.changed",
        {
          bundle_version: null,
          theme_revision: 1,
          until: null,
          restores: null,
          reason: "set",
          actor_user_id: "u_admin",
        },
        { version: 1 },
      ),
    );
    const subscription = listenPins(new Bus(d.h.store, "theming"), deps(), { blockMs: 10 });
    try {
      await expect
        .poll(() =>
          inAlpha(() =>
            d.h.db.tenant(
              async (c) => (await c.query(`SELECT theme_revision FROM theming_pins`)).rows,
            ),
          ),
        )
        .toEqual([{ theme_revision: 1 }]);
    } finally {
      await subscription.close();
    }
  });

  it("releases a pruned revision's embed files, keeping one a kept revision shares", async () => {
    for (let n = 1; n <= 20; n += 1) await publish(n);
    const own = Buffer.from("<!doctype html><p>only revision 1</p>");
    // Revision 2 shares it, not 20: an embed on the current revision would make the next
    // publish an embed change, which needs the embeds right.
    const shared = Buffer.from("<!doctype html><p>revisions 1 and 2</p>");
    const names = await inAlpha(() =>
      d.h.db.tenant(async (c) => {
        await putEmbed(
          c,
          d.h.files,
          "r:1",
          "own",
          "embeds/own/index.html",
          new Map([["embeds/own/index.html", own]]),
        );
        for (const owner of ["r:1", "r:2"]) {
          await putEmbed(
            c,
            d.h.files,
            owner,
            "shared",
            "embeds/shared/index.html",
            new Map([["embeds/shared/index.html", shared]]),
          );
        }
        const { rows } = await c.query(
          `SELECT embed, file FROM theming_embed_files WHERE owner = 'r:1' ORDER BY embed`,
        );
        return Object.fromEntries(
          (rows as { embed: string; file: string }[]).map((r) => [r.embed, r.file]),
        );
      }),
    );
    d.h.storage.used.alpha = 10_000;
    await inAlpha(() => pruneRevisions(deps()));
    expect(await kept()).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));

    await publish(21);
    expect(await onDisk(names.own as string)).toBe(false);
    expect(await onDisk(names.shared as string)).toBe(true);
    expect(d.h.storage.used.alpha).toBeLessThanOrEqual(10_000 - own.length);
  });
});
