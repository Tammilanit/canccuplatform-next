/**
 * The readability warnings through the API (contracts/theming.md, Advanced mode): `text_small` and
 * `contrast_low` are among the draft's problems on every change, so the publish page shows them,
 * and publish's 422 lists them with the errors; they never block a publish.
 */
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { DATABASE_URL, code, send } from "./helpers.js";
import { draftFiles, png } from "./drafting.js";
import type { DraftBody } from "./drafting.js";
import { putPackage } from "./packaging.js";
import { packageZip } from "./zips.js";

interface Problem {
  severity: string;
  code: string;
  path?: string;
  message: string;
}

const theme = (css: string[]): string =>
  stringify({
    schema_version: 1,
    name: "Small",
    mode: "advanced",
    // Dark text on a dark background: contrast_low.
    tokens: { colors: { text: "#222222", background: "#000000" } },
    css,
  });

const warnings = (body: { problems: unknown[] }, which: string): Problem[] =>
  (body.problems as Problem[]).filter((p) => p.code === which);

describe.skipIf(!DATABASE_URL)("readability warnings", () => {
  const d = draftFiles();

  it("lists text_small per selector, with rem against the root size another file sets", async () => {
    const res = await putPackage(
      d.h,
      packageZip({
        "theme.yaml": theme(["css/base.css", "css/cards.css"]),
        "css/base.css":
          ":root { font-size: 20px; } .canccu-surface--hub .t-tiny { font-size: 8px; }",
        "css/cards.css": ".t-card { font-size: 1.25rem; } .t-big { font-size: 1.5rem; }",
        // Not in theme.yaml, so no part of the theme.
        "css/unused.css": ".t-unused { font-size: 4px; }",
      }),
    );
    expect(res.statusCode).toBe(200);
    const draft = res.json<DraftBody>();
    const small = warnings(draft, "text_small");
    expect(small).toEqual([
      expect.objectContaining({ severity: "warning", path: "css/cards.css" }),
    ]);
    expect(small[0]?.message).toContain(".t-card");
    expect(small[0]?.message).toContain("25px");

    // A larger root in base.css lifts cards.css over the line: the check reads every file again.
    const lifted = await d.put(
      "css/base.css",
      draft.draft_version,
      Buffer.from(":root { font-size: 22px; }"),
    );
    expect(warnings(lifted.json<DraftBody>(), "text_small")).toEqual([]);
  });

  it("returns text_small and contrast_low with the errors on a refused publish, and publishes past them", async () => {
    const res = await putPackage(
      d.h,
      packageZip({
        "theme.yaml": theme(["css/theme.css"]),
        "css/theme.css": ".t-a { font-size: 12px; background: url(images/bg.png); }",
      }),
    );
    const draft = res.json<DraftBody>();
    const refused = await send(d.h, "POST", "/api/theming/draft/publish", {
      draft_version: draft.draft_version,
    });
    expect(refused.statusCode).toBe(422);
    expect(code(refused)).toBe("theme_invalid");
    const body = refused.json<{ error: { problems: Problem[] } }>().error;
    expect(body.problems.map((p) => `${p.severity} ${p.code}`)).toEqual(
      expect.arrayContaining(["error css_forbidden", "warning text_small", "warning contrast_low"]),
    );

    const fixed = await d.put("images/bg.png", draft.draft_version, await png());
    const ready = fixed.json<DraftBody>();
    expect(warnings(ready, "text_small")).toHaveLength(1);
    expect(warnings(ready, "contrast_low").length).toBeGreaterThan(0);
    const published = await send(d.h, "POST", "/api/theming/draft/publish", {
      draft_version: ready.draft_version,
    });
    expect(published.statusCode).toBe(201);
  });

  it("keeps a revision's font sizes, so a draft made from it warns the same", async () => {
    const res = await putPackage(
      d.h,
      packageZip({
        "theme.yaml": theme(["css/theme.css"]),
        "css/theme.css": ".t-a { font-size: 12px; }",
      }),
    );
    const published = await send(d.h, "POST", "/api/theming/draft/publish", {
      draft_version: res.json<DraftBody>().draft_version,
    });
    expect(published.statusCode).toBe(201);
    const again = await send(d.h, "POST", "/api/theming/draft", { from: "current" });
    expect(again.statusCode).toBe(201);
    expect(warnings(again.json<DraftBody>(), "text_small")).toHaveLength(1);
  });
});
