/** Publish around revision 0 and the bus: the profile's theme, `changed`, a lost event. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTenant } from "@canccu/kit";
import { DATABASE_URL, code, get, harness, send } from "./helpers.js";
import type { Harness } from "./helpers.js";
import type { DraftBody } from "./drafting.js";

interface Revision {
  mode: string;
  manifest: Record<string, unknown>;
}

describe.skipIf(!DATABASE_URL)("theming publish at revision 0", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    h.store.streams.clear();
    for (const tenant of ["alpha", "venue", "fonted"]) {
      await withTenant(tenant, () =>
        h.db.tenant(async (c) => {
          for (const table of ["drafts", "revisions", "file_refs", "embed_files"]) {
            await c.query(`DELETE FROM theming_${table}`);
          }
        }),
      );
    }
  });

  describe("revision 0 with the event profile's theme", () => {
    const venue = { host: "venue.test" };
    const publishDraft = async (from: string) => {
      expect((await send(h, "POST", "/api/theming/draft", { from }, venue)).statusCode).toBe(201);
      return send(h, "POST", "/api/theming/draft/publish", { draft_version: 1 }, venue);
    };

    it("from a profile font no package holds: the error publish names, in words (UX audit C1)", async () => {
      const fonted = { host: "fonted.test" };
      const res = await send(h, "POST", "/api/theming/draft", { from: "current" }, fonted);
      expect(res.statusCode).toBe(201);
      const problems = res.json<DraftBody>().problems;
      expect(problems).toEqual([
        {
          severity: "error",
          code: "reference_unknown",
          path: "theme.yaml#/tokens/fonts/body",
          message:
            "The text font Inter isn't in the theme, so screens would fall back to another font. Use the system font, or upload Inter.",
        },
      ]);
      const refused = await send(
        h,
        "POST",
        "/api/theming/draft/publish",
        { draft_version: 1 },
        fonted,
      );
      expect([refused.statusCode, code(refused)]).toEqual([422, "theme_invalid"]);
      expect(refused.json<{ error: { problems: unknown[] } }>().error.problems).toEqual(problems);
    });

    it("keeps the profile's colours in a draft from current, published unchanged", async () => {
      const shown = (await get(h, "/api/theming/current", venue)).json<{
        tokens: { colors: Record<string, string> };
      }>();
      expect(shown.tokens.colors.primary).toBe("#14b8a6");
      const res = await publishDraft("current");
      expect(res.statusCode).toBe(201);
      expect(res.json<Revision>()).toMatchObject({
        mode: "simple",
        manifest: { brand: { primary: "#14b8a6" } },
      });
      const now = (await get(h, "/api/theming/current", venue)).json<typeof shown>();
      expect(now.tokens).toEqual(shown.tokens);
      // Nothing surfaces show changed, so nothing is announced as changed.
      expect(h.events("venue").at(-1)?.data.changed).toEqual([]);
    });

    it("announces tokens changed when a draft from the defaults replaces the profile's colours", async () => {
      expect((await publishDraft("defaults")).statusCode).toBe(201);
      expect(h.events("venue").at(-1)?.data.changed).toEqual(["tokens"]);
    });
  });

  it("answers 201 for a committed revision even when its event cannot be sent", async () => {
    await send(h, "POST", "/api/theming/draft", { from: "defaults" });
    const xadd = h.store.xadd.bind(h.store);
    h.store.xadd = () => Promise.reject(new Error("valkey down"));
    try {
      const res = await send(h, "POST", "/api/theming/draft/publish", { draft_version: 1 });
      expect(res.statusCode).toBe(201);
    } finally {
      h.store.xadd = xadd;
    }
    expect((await get(h, "/api/theming/current")).json<{ revision: number }>().revision).toBe(1);
  });
});
