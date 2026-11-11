/**
 * CSS and templates through the API (contracts/theming.md, Advanced mode and Widget templates):
 * checked at upload, one file or a whole package; the package paths they name checked on every
 * draft change; compiled at publish into the served CSS and the parsed trees of `current`.
 */
import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { tenantFile, withTenant } from "@canccu/kit";
import { DATABASE_URL, caller, code, get, send } from "./helpers.js";
import { draftFiles, png } from "./drafting.js";
import type { DraftBody } from "./drafting.js";
import { putPackage } from "./packaging.js";
import { packageZip } from "./zips.js";

interface Problem {
  severity: string;
  code: string;
  path: string;
  message: string;
}

const HOSTILE_CSS: Record<string, string> = {
  "@import": `@import url(css/other.css);`,
  "data:": `.t-a { background: url(data:image/svg+xml;base64,PHN2Zy8+); }`,
  "expression()": `.t-a { width: expression(alert(document.cookie)); }`,
  "var() in image-set()": `:root { --u: "https://tracker.example/p.png"; } .t-a { background-image: image-set(var(--u) 1x); }`,
};

const HOSTILE_TEMPLATES: Record<string, string> = {
  "{{{ }}}": `<p>{{{html}}}</p>`,
  "on*": `<img src="images/a.png" onerror="alert(1)">`,
  style: `<p style="background:url(//evil.test/x)">x</p>`,
  href: `<p href="https://evil.test">x</p>`,
};

const manifest = (extra: Record<string, unknown>): string =>
  stringify({ schema_version: 1, name: "Styled", mode: "advanced", tokens: {}, ...extra });

describe.skipIf(!DATABASE_URL)("CSS and templates", () => {
  const d = draftFiles();
  const { fresh, put, remove, fileAt } = d;
  const problems = (body: DraftBody): Problem[] => body.problems as Problem[];

  it.each(Object.entries(HOSTILE_CSS))("refuses CSS with %s, storing nothing", async (_n, css) => {
    const draft = await fresh();
    const res = await put("css/theme.css", draft.draft_version, Buffer.from(css));
    expect(res.statusCode).toBe(200);
    expect(problems(res.json<DraftBody>())).toContainEqual(
      expect.objectContaining({ code: "css_forbidden", path: "css/theme.css", severity: "error" }),
    );
    expect(await fileAt("css/theme.css")).toBeUndefined();
  });

  it.each(Object.entries(HOSTILE_TEMPLATES))(
    "refuses a template with %s, storing nothing",
    async (_n, source) => {
      const draft = await fresh();
      const res = await put("templates/t.mustache", draft.draft_version, Buffer.from(source));
      expect(problems(res.json<DraftBody>())).toContainEqual(
        expect.objectContaining({ code: "template_forbidden", path: "templates/t.mustache" }),
      );
      expect(await fileAt("templates/t.mustache")).toBeUndefined();
    },
  );

  it("holds a hostile file of a package as its problem, the rest stored", async () => {
    const res = await putPackage(
      d.h,
      packageZip({
        "theme.yaml": manifest({ css: ["css/bad.css", "css/good.css"] }),
        "css/bad.css": HOSTILE_CSS["@import"] as string,
        "css/good.css": ".t-a { color: red; }",
        "templates/bad.mustache": HOSTILE_TEMPLATES["{{{ }}}"] as string,
      }),
    );
    expect(res.statusCode).toBe(200);
    const codes = problems(res.json<DraftBody>()).map((p) => `${p.code} ${p.path}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        "css_forbidden css/bad.css",
        "template_forbidden templates/bad.mustache",
      ]),
    );
    expect(await fileAt("css/bad.css")).toBeUndefined();
    expect(await fileAt("css/good.css")).toMatch(/\.css$/);
  });

  it("checks the files CSS and templates name on every change, and makes the draft advanced", async () => {
    const draft = await fresh();
    expect(draft.mode).toBe("simple");
    const css = await put(
      "css/theme.css",
      draft.draft_version,
      Buffer.from(`.canccu-page { background: url(images/bg.png); } .legacy { color: red; }`),
    );
    const one = css.json<DraftBody>();
    expect(one.mode).toBe("advanced");
    expect(problems(one)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "css_forbidden",
          path: "css/theme.css",
          severity: "error",
        }),
        expect.objectContaining({ code: "class_unstable", severity: "warning" }),
      ]),
    );
    const tpl = await put(
      "templates/card.mustache",
      one.draft_version,
      Buffer.from(`<div class="t-card"><img src="images/bg.png" alt="{{alt}}"></div>`),
    );
    expect(problems(tpl.json<DraftBody>()).map((p) => `${p.code} ${p.path}`)).toEqual(
      expect.arrayContaining([
        "css_forbidden css/theme.css",
        "template_forbidden templates/card.mustache",
      ]),
    );
    const image = await put("images/bg.png", one.draft_version + 1, await png());
    const fixed = image.json<DraftBody>();
    expect(problems(fixed).filter((p) => p.severity === "error")).toEqual([]);
    // Removing the image brings the errors back.
    const gone = (await remove("images/bg.png", fixed.draft_version)).json<DraftBody>();
    expect(
      problems(gone)
        .filter((p) => p.severity === "error")
        .map((p) => p.path),
    ).toEqual(["css/theme.css", "templates/card.mustache"]);
  });

  it("refuses CSS over 256 KB together", async () => {
    const draft = await fresh();
    const big = Buffer.from(".t-a{color:red}\n".repeat(9000));
    await put("css/a.css", draft.draft_version, big);
    const res = await put("css/b.css", draft.draft_version + 1, big);
    expect(problems(res.json<DraftBody>())).toContainEqual(
      expect.objectContaining({ code: "file_too_large", path: "css/" }),
    );
  });

  async function publishStyled(): Promise<{
    css_url: string;
    templates: unknown[];
    revision: number;
  }> {
    const put = await putPackage(
      d.h,
      packageZip({
        "theme.yaml": manifest({
          images: { bg: "images/bg.png" },
          css: ["css/a.css", "css/b.css"],
          templates: { card: { widget: "clock", file: "templates/card.mustache" } },
        }),
        "images/bg.png": await png(),
        "css/a.css": `@charset "UTF-8";\n.canccu-page { background: url(images/bg.png); }`,
        "css/b.css": `.t-card { color: red; }`,
        "templates/card.mustache": `<div class="t-card">{{#on}}<img src="images/bg.png" alt="">{{/on}}<time datetime="{{iso}}">{{time}}</time></div>`,
      }),
    );
    expect(problems(put.json<DraftBody>()).filter((p) => p.severity === "error")).toEqual([]);
    const published = await send(d.h, "POST", "/api/theming/draft/publish", {
      draft_version: put.json<DraftBody>().draft_version,
    });
    expect(published.statusCode).toBe(201);
    return (await get(d.h, "/api/theming/current")).json();
  }

  it("publishes the CSS compiled into @layer canccu-theme, and the parsed templates", async () => {
    const current = await publishStyled();
    // Surfaces that follow the event load the CSS without reading `current` again.
    expect(d.h.events("alpha").at(-1)?.data.css_url).toBe(current.css_url);
    const image = `/theming/a/${String(await fileAt("images/bg.png", "r:1"))}`;
    const served = await get(d.h, current.css_url);
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toBe("text/css; charset=utf-8");
    expect(served.body).toBe(
      `@layer canccu-theme{.canccu-page{background:url(${image})}\n.t-card{color:red}}`,
    );
    expect((await get(d.h, image)).statusCode).toBe(200);
    expect(current.templates).toEqual([
      {
        name: "card",
        widget: "clock",
        tree: [
          {
            element: "div",
            attrs: { class: [{ text: "t-card" }] },
            children: [
              {
                section: "on",
                inverted: false,
                children: [{ element: "img", attrs: { src: [{ text: image }], alt: [] } }],
              },
              {
                element: "time",
                attrs: { datetime: [{ field: "iso" }] },
                children: [{ field: "time" }],
              },
            ],
          },
        ],
      },
    ]);
    // The same for a module reading the revision pinned.
    const pinned = await d.h.app.inject({
      method: "GET",
      url: "/internal/theming/revisions/1?tenant_id=alpha",
      headers: { host: "theming:8080", ...caller("screen") },
    });
    expect(pinned.json<{ css_url: string; templates: unknown }>()).toMatchObject({
      css_url: current.css_url,
      templates: current.templates,
    });
  });

  it("restores a revision's CSS and templates, and refuses one that no longer compiles", async () => {
    const first = await publishStyled();
    const restored = await send(d.h, "POST", "/api/theming/revisions/1/restore", {
      current_revision: 1,
    });
    expect(restored.statusCode).toBe(201);
    const current = (await get(d.h, "/api/theming/current")).json<{
      css_url: string;
      templates: unknown[];
    }>();
    expect(current.css_url).toBe(first.css_url);
    expect(current.templates).toEqual(first.templates);
    expect(d.h.events("alpha").at(-1)?.data).toMatchObject({
      revision: 2,
      restored_from: 1,
      css_url: first.css_url,
    });
    // A CSS file gone from the volume: the restore writes nothing and says why.
    const name = String(await fileAt("css/a.css", "r:1"));
    await withTenant("alpha", () => rm(tenantFile("theming", `files/${name}`, d.h.root)));
    const refused = await send(d.h, "POST", "/api/theming/revisions/1/restore", {
      current_revision: 2,
    });
    expect(refused.statusCode).toBe(422);
    expect(code(refused)).toBe("theme_invalid");
    expect((await get(d.h, "/api/theming/current")).json<{ revision: number }>().revision).toBe(2);
  });
});
