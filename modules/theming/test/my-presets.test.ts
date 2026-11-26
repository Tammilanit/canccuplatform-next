/**
 * My presets (contracts/theming.md, Presets; plan issue-784 D18): the draft saved under a name is
 * listed under Your looks, applies as a preset does with the event's logo kept, holds its files
 * until it is deleted, and stays the event's own under RLS.
 */
import { readFile } from "node:fs/promises";
import { withTenant } from "@canccu/kit";
import { describe, expect, it } from "vitest";
import { draftFiles, png } from "./drafting.js";
import type { DraftBody } from "./drafting.js";
import { DATABASE_URL, code, get, send } from "./helpers.js";

interface Draft extends DraftBody {
  manifest: Record<string, unknown> & {
    tokens: { colors: Record<string, string> };
    images?: Record<string, string>;
    preset?: { id: string; scheme: string };
  };
}

interface Mine {
  id: string;
  name: string;
  embeds: boolean;
  colors: Record<string, string>;
}

const BLACK_LOGO = new URL("../../../events/demo/images/logo-black.svg", import.meta.url);

describe.skipIf(!DATABASE_URL)("my presets", () => {
  const t = draftFiles();

  const save = (name: unknown, host = "alpha.test", session = "admin") =>
    send(t.h, "POST", "/api/theming/presets", { name }, { host, session });
  const mine = async (host = "alpha.test"): Promise<Mine[]> =>
    (await get(t.h, "/api/theming/presets", { session: "admin", host })).json<{ mine: Mine[] }>()
      .mine;
  const apply = (body: Record<string, unknown>, host = "alpha.test") =>
    send(t.h, "PUT", "/api/theming/draft/preset", body, { host, session: "embedder" });
  const draftNow = async (): Promise<Draft> =>
    (await get(t.h, "/api/theming/draft", { session: "admin" })).json<Draft>();

  /** A draft with a logo, a picture and its own colours: what "Spring look" saves. */
  async function springDraft(): Promise<Draft> {
    const fresh = await t.fresh();
    const logo = await t.put("images/logo.svg", fresh.draft_version, await readFile(BLACK_LOGO));
    const picture = await t.put(
      "images/spring.png",
      logo.json<Draft>().draft_version,
      await png("#4ade80", 16),
    );
    const brand = await send(t.h, "PUT", "/api/theming/draft/brand", {
      draft_version: picture.json<Draft>().draft_version,
      primary: "#22c55e",
      accent: "#f472b6",
      scheme: "dark",
      logo: "images/logo.svg",
    });
    expect(brand.statusCode).toBe(200);
    return brand.json<{ draft: Draft }>().draft;
  }

  it("lists the draft saved as Spring look under Your looks", async () => {
    const draft = await springDraft();
    const res = await save("Spring look");
    expect(res.statusCode).toBe(201);
    const saved = res.json<Mine>();
    expect(saved.id).toMatch(/^event:[1-9][0-9]*$/);
    expect(saved.name).toBe("Spring look");
    expect(saved.colors.primary).toBe(draft.manifest.tokens.colors.primary);
    expect((await mine()).map((p) => p.name)).toEqual(["Spring look"]);
    // Saving changes nothing in the draft.
    expect((await draftNow()).draft_version).toBe(draft.draft_version);
  });

  it("refuses a missing name, a long one, no draft and a member", async () => {
    expect(code(await save(""))).toBe("invalid_request");
    expect(code(await save("x".repeat(61)))).toBe("invalid_request");
    expect(code(await save(7))).toBe("invalid_request");
    expect((await save("No draft")).statusCode).toBe(404);
    await springDraft();
    expect((await save("Member", "alpha.test", "member")).statusCode).toBe(403);
  });

  it("applies it to a new draft with the saved manifest and the event's logo kept", async () => {
    const spring = await springDraft();
    const id = (await save("Spring look")).json<Mine>().id;
    // The event's logo changes after the save; applying the look keeps the new one.
    const other = await t.put("images/logo.png", spring.draft_version, await png("#111111", 32));
    const relogo = await send(t.h, "PUT", "/api/theming/draft/brand", {
      draft_version: other.json<Draft>().draft_version,
      primary: "#3ddcff",
      accent: "#b98cff",
      scheme: "dark",
      logo: "images/logo.png",
    });
    expect(relogo.statusCode).toBe(200);
    const relogoed = relogo.json<{ draft: Draft }>().draft;
    const res = await apply({ preset: id, draft_version: relogoed.draft_version });
    expect(res.statusCode).toBe(200);
    const applied = res.json<Draft>();
    expect(applied.manifest.tokens.colors).toEqual(spring.manifest.tokens.colors);
    expect(applied.manifest.images?.logo).toBe("images/logo.png");
    expect(applied.manifest.preset).toEqual({ id, scheme: "own" });
    const paths = (applied.files ?? []).map((f) => f.path);
    expect(paths).toContain("images/spring.png");
    expect(paths).toContain("images/logo.png");
    expect(applied.problems.filter((p) => p.severity === "error")).toEqual([]);

    // And with no draft at all, as the gallery does after a publish or discard.
    const gone = await send(
      t.h,
      "DELETE",
      `/api/theming/draft?draft_version=${applied.draft_version}`,
    );
    expect(gone.statusCode).toBe(204);
    const started = await apply({ preset: id });
    expect(started.statusCode).toBe(200);
    expect(started.json<Draft>().manifest.tokens.colors).toEqual(spring.manifest.tokens.colors);
  });

  it("frees on delete the files that only it held", async () => {
    const spring = await springDraft();
    const id = (await save("Spring look")).json<Mine>().id;
    const picture = await t.fileAt("images/spring.png");
    expect(picture).toBeDefined();
    // The draft lets the picture go; the saved look still holds it.
    const dropped = await t.remove("images/spring.png", spring.draft_version);
    expect(dropped.statusCode).toBe(200);
    expect(await t.onDisk()).toContain(picture);
    const before = t.h.storage.used.alpha ?? 0;

    const res = await send(t.h, "DELETE", `/api/theming/presets/${id}`);
    expect(res.statusCode).toBe(204);
    expect(await mine()).toEqual([]);
    expect(await t.onDisk()).not.toContain(picture);
    expect(t.h.storage.used.alpha).toBeLessThan(before);
    // The logo the draft still holds stays.
    expect(await t.fileAt("images/logo.svg")).toBeDefined();
    expect((await send(t.h, "DELETE", `/api/theming/presets/${id}`)).statusCode).toBe(404);
  });

  it("keeps one event's looks from another (RLS)", async () => {
    await springDraft();
    const id = (await save("Spring look")).json<Mine>().id;
    expect(await mine("beta.test")).toEqual([]);
    const beta = await send(
      t.h,
      "POST",
      "/api/theming/draft",
      { from: "defaults" },
      {
        host: "beta.test",
      },
    );
    expect(beta.statusCode).toBe(201);
    const applied = await apply(
      { preset: id, draft_version: beta.json<Draft>().draft_version },
      "beta.test",
    );
    expect(applied.statusCode).toBe(404);
    const removed = await send(t.h, "DELETE", `/api/theming/presets/${id}`, undefined, {
      host: "beta.test",
    });
    expect(removed.statusCode).toBe(404);
    const rows = await withTenant("beta", () =>
      t.h.db.tenant(async (c) => (await c.query(`SELECT 1 FROM theming_presets`)).rows.length),
    );
    expect(rows).toBe(0);
    expect((await mine()).map((p) => p.id)).toEqual([id]);
  });

  it("names an unknown look as not found", async () => {
    await springDraft();
    expect((await apply({ preset: "event:999" })).statusCode).toBe(404);
    expect((await send(t.h, "DELETE", "/api/theming/presets/event:999")).statusCode).toBe(404);
    expect((await send(t.h, "DELETE", "/api/theming/presets/nope")).statusCode).toBe(404);
  });
});
