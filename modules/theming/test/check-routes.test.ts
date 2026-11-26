/**
 * The Advanced page's own paths (plan issue-784 D15, D16; contracts/theming.md, Advanced mode):
 * `POST /api/theming/draft/check` runs one CSS file's or template's checks without storing
 * anything and answers each problem with its line, and `PATCH /api/theming/draft/parts` puts what
 * the page uploaded into theme.yaml: the CSS order, own fonts, templates, box looks and the
 * screen's own picture.
 */
import { describe, expect, it } from "vitest";
import { draftFiles, png, woff2 } from "./drafting.js";
import type { DraftBody } from "./drafting.js";
import { DATABASE_URL, code, get, send } from "./helpers.js";

interface Problem {
  severity: string;
  code: string;
  path?: string;
  message: string;
  line?: number;
  column?: number;
}
interface Draft extends DraftBody {
  manifest: Record<string, unknown> & {
    css?: string[];
    fonts?: Record<string, unknown>[];
    templates?: Record<string, { widget: string; file: string }>;
    layouts?: { regions: { widgets: { widget: string; template?: string }[] }[] }[];
    brand?: { backdrop?: { image?: string } };
    tokens?: { fonts?: Record<string, string> };
  };
}

const LAYOUT = {
  id: "main",
  name: "Main hall",
  aspect: "16:9",
  grid: { columns: 4, rows: 2 },
  regions: [
    {
      id: "a",
      area: { column: 1, row: 1, columns: 2, rows: 2 },
      widgets: [{ widget: "countdown" }],
    },
    { id: "b", area: { column: 3, row: 1, columns: 2, rows: 2 }, widgets: [{ widget: "clock" }] },
  ],
};
const COUNTDOWN = Buffer.from(
  '<div class="canccu-widget t-big">{{title}} <span class="t-time">{{starts_in}}</span></div>',
);

describe.skipIf(!DATABASE_URL)("the Advanced page's paths", () => {
  const t = draftFiles();
  const check = (body: unknown, session?: string) =>
    send(t.h, "POST", "/api/theming/draft/check", body, session === undefined ? {} : { session });
  const parts = (body: unknown, session?: string) =>
    send(t.h, "PATCH", "/api/theming/draft/parts", body, session === undefined ? {} : { session });
  const draftNow = async (): Promise<Draft> =>
    (await get(t.h, "/api/theming/draft", { session: "admin" })).json<Draft>();

  describe("POST /api/theming/draft/check", () => {
    it("answers a forbidden CSS rule with its line and stores nothing", async () => {
      const before = await t.fresh();
      const bytes = await t.storedBytes();
      const res = await check({
        path: "css/theme.css",
        text: ".t-a {\n  color: red;\n}\n@import url(x.css);\n",
      });
      expect(res.statusCode).toBe(200);
      const { problems } = res.json<{ problems: Problem[] }>();
      const forbidden = problems.find((p) => p.code === "css_forbidden");
      expect(forbidden).toMatchObject({ severity: "error", path: "css/theme.css", line: 4 });
      expect(forbidden?.column).toBe(1);
      expect((await draftNow()).draft_version).toBe(before.draft_version);
      expect(await t.storedBytes()).toBe(bytes);
      expect(t.h.storage.used.alpha ?? 0).toBe(0);
    });

    it("lists each refused rule on its own line", async () => {
      await t.fresh();
      const res = await check({
        path: "css/theme.css",
        text: ".t-a {\n  background: url(https://example.org/a.png);\n}\n.t-b { behavior: x; }\n",
      });
      const lines = res
        .json<{ problems: Problem[] }>()
        .problems.filter((p) => p.code === "css_forbidden")
        .map((p) => p.line);
      expect(lines).toEqual([2, 4]);
    });

    it("names a package image the draft does not hold, and small text, with their lines", async () => {
      await t.fresh();
      const res = await check({
        path: "css/theme.css",
        text: ".t-a {\n  background: url(images/none.png);\n}\n.t-b {\n  font-size: 12px;\n}\n",
      });
      const { problems } = res.json<{ problems: Problem[] }>();
      expect(problems.find((p) => p.code === "css_forbidden")).toMatchObject({ line: 2 });
      expect(problems.find((p) => p.code === "text_small")).toMatchObject({
        severity: "warning",
        line: 5,
      });
    });

    it("answers a template's refusal with its line", async () => {
      await t.fresh();
      const res = await check({
        path: "templates/countdown.mustache",
        text: "<div>\n<p>{{title}}</p>\n<p>{{{raw}}}</p>\n</div>",
      });
      const { problems } = res.json<{ problems: Problem[] }>();
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ code: "template_forbidden", line: 3 });
    });

    it("answers no problems for a clean file", async () => {
      await t.fresh();
      const res = await check({ path: "templates/countdown.mustache", text: COUNTDOWN.toString() });
      expect(res.json<{ problems: Problem[] }>().problems).toEqual([]);
    });

    it("takes only CSS and templates, and only from a writer", async () => {
      await t.fresh();
      expect((await check({ path: "images/a.svg", text: "<svg/>" })).statusCode).toBe(400);
      expect((await check({ path: "css/../x.css", text: "" })).statusCode).toBe(400);
      const member = await check({ path: "css/theme.css", text: "" }, "member");
      expect(member.statusCode).toBe(403);
    });
  });

  describe("PATCH /api/theming/draft/parts", () => {
    it("lists an uploaded CSS file, which makes the draft advanced", async () => {
      const fresh = await t.fresh();
      const up = await t.put("css/theme.css", fresh.draft_version, Buffer.from(".t-a{color:red}"));
      expect(up.statusCode).toBe(200);
      const res = await parts({
        draft_version: up.json<Draft>().draft_version,
        css: ["css/theme.css"],
      });
      expect(res.statusCode).toBe(200);
      const d = res.json<Draft>();
      expect(d.manifest.css).toEqual(["css/theme.css"]);
      expect(d.mode).toBe("advanced");
      expect(d.problems.filter((p) => p.severity === "error")).toEqual([]);
    });

    it("adds an own font with its licence, which a font token can then name", async () => {
      const fresh = await t.fresh();
      const font = await t.put("fonts/orbit.woff2", fresh.draft_version, woff2());
      expect(font.statusCode).toBe(200);
      const licence = await t.put(
        "fonts/orbit.txt",
        font.json<Draft>().draft_version,
        Buffer.from("SIL Open Font License 1.1"),
      );
      expect(licence.statusCode).toBe(200);
      expect(licence.json<Draft>().problems.filter((p) => p.severity === "error")).toEqual([]);
      const entry = {
        family: "Orbit",
        file: "fonts/orbit.woff2",
        licence: "OFL-1.1",
        licence_file: "fonts/orbit.txt",
      };
      const res = await parts({
        draft_version: licence.json<Draft>().draft_version,
        fonts: [entry],
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<Draft>().manifest.fonts).toEqual([entry]);
      const named = await send(t.h, "PATCH", "/api/theming/draft/tokens", {
        draft_version: res.json<Draft>().draft_version,
        tokens: { fonts: { heading: "Orbit" } },
      });
      expect(named.statusCode).toBe(200);
      expect(named.json<Draft>().problems.map((p) => p.code)).not.toContain("reference_unknown");
    });

    it("refuses a licence that is no text", async () => {
      const fresh = await t.fresh();
      const res = await t.put("fonts/orbit.txt", fresh.draft_version, Buffer.from([0, 255, 0, 1]));
      expect(res.statusCode).toBe(200);
      expect(res.json<Draft>().problems).toContainEqual(
        expect.objectContaining({ code: "file_type", path: "fonts/orbit.txt" }),
      );
    });

    it("gives every box of a type the look made for it, and takes it back", async () => {
      const fresh = await t.fresh();
      const layout = await send(
        t.h,
        "PUT",
        `/api/theming/draft/layouts/main?draft_version=${fresh.draft_version}`,
        LAYOUT,
      );
      expect(layout.statusCode).toBe(200);
      const up = await t.put(
        "templates/countdown-look.mustache",
        layout.json<Draft>().draft_version,
        COUNTDOWN,
      );
      expect(up.statusCode).toBe(200);
      const res = await parts({
        draft_version: up.json<Draft>().draft_version,
        templates: {
          countdown_look: { widget: "countdown", file: "templates/countdown-look.mustache" },
        },
        looks: { countdown: "countdown_look" },
      });
      expect(res.statusCode).toBe(200);
      const d = res.json<Draft>();
      expect(d.manifest.templates?.countdown_look?.widget).toBe("countdown");
      const widgets = d.manifest.layouts?.[0]?.regions.flatMap((r) => r.widgets) ?? [];
      expect(widgets).toEqual([
        { widget: "countdown", template: "countdown_look" },
        { widget: "clock" },
      ]);
      expect(d.problems.filter((p) => p.severity === "error")).toEqual([]);
      const back = await parts({ draft_version: d.draft_version, looks: { countdown: null } });
      const after = back.json<Draft>().manifest.layouts?.[0]?.regions[0]?.widgets;
      expect(after).toEqual([{ widget: "countdown" }]);
    });

    it("refuses a look made for another type of box", async () => {
      const fresh = await t.fresh();
      const res = await parts({
        draft_version: fresh.draft_version,
        looks: { countdown: "nothing_here" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("puts the organiser's own picture behind the boxes, and the cycle back", async () => {
      const fresh = await t.fresh();
      const up = await t.put("images/backdrop.png", fresh.draft_version, await png("#223344", 32));
      const res = await parts({
        draft_version: up.json<Draft>().draft_version,
        backdrop_image: "images/backdrop.png",
      });
      expect(res.statusCode).toBe(200);
      const d = res.json<Draft>();
      expect(d.manifest.brand?.backdrop?.image).toBe("images/backdrop.png");
      // A picture is no styling: the simple mode stays simple.
      expect(d.mode).toBe("simple");
      const back = await parts({ draft_version: d.draft_version, backdrop_image: null });
      expect(back.json<Draft>().manifest.brand?.backdrop?.image).toBeUndefined();
    });

    it("is 409 on a stale version and 403 without the write right", async () => {
      const fresh = await t.fresh();
      const stale = await parts({ draft_version: fresh.draft_version + 1, css: [] });
      expect(stale.statusCode).toBe(409);
      expect(code(stale)).toBe("version_conflict");
      const member = await parts({ draft_version: fresh.draft_version, css: [] }, "member");
      expect(member.statusCode).toBe(403);
      const unknown = await parts({ draft_version: fresh.draft_version, name: "x" });
      expect(unknown.statusCode).toBe(400);
    });
  });
});
