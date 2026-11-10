import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, code, demoEmbed, get, harness, raw, seedEmbeds } from "./helpers.js";
import type { EmbedFiles, Harness } from "./helpers.js";

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

const FRAME = { "sec-fetch-dest": "iframe", "sec-fetch-site": "same-origin" };
// What a sandboxed document's own requests carry: its origin is opaque, so every one is cross-site.
const FROM_SANDBOX = { "sec-fetch-dest": "script", "sec-fetch-site": "cross-site" };

const BASE = "http://alpha.test/theming/sandbox/1/drift/";
const POLICY =
  `default-src 'none'; script-src ${BASE}; style-src ${BASE} 'unsafe-inline'; ` +
  `img-src ${BASE} data:; font-src ${BASE}; media-src ${BASE}; connect-src 'none'; ` +
  `form-action 'none'; base-uri 'none'; frame-ancestors http://alpha.test; sandbox allow-scripts`;

const NESTED: EmbedFiles = {
  entry: "embeds/nested/pages/main.html",
  files: {
    "embeds/nested/pages/main.html": Buffer.from("<!doctype html><p>nested</p>"),
    "embeds/nested/data/points.json": Buffer.from("[1,2,3]"),
    "embeds/nested/look.css": Buffer.from("p { color: red }"),
  },
};

describe.skipIf(!DATABASE_URL)("the same-host sandbox", () => {
  let h: Harness;
  let drift: EmbedFiles;
  beforeAll(async () => {
    h = await harness();
    drift = await demoEmbed("level-up", "drift");
    await seedEmbeds(h, "alpha", { revision: 1 }, { drift, nested: NESTED });
    await seedEmbeds(h, "beta", { draftKey: "k".repeat(43) }, { drift });
  });
  afterAll(async () => {
    await h.close();
  });

  describe("an embed's entry", () => {
    it("is served to a frame with the sandbox CSP and the cross-origin headers", async () => {
      const res = await get(h, "/theming/sandbox/1/drift/index.html", {}, FRAME);
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(drift.files["embeds/drift/index.html"]?.toString());
      expect(res.headers).toMatchObject({
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": POLICY,
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "cross-origin",
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=31536000, immutable",
        vary: "Sec-Fetch-Dest, Sec-Fetch-Site",
      });
      expect(res.headers).not.toHaveProperty("access-control-allow-credentials");
    });

    it("sets no cookie, even to a request that carries a session", async () => {
      const res = await get(h, "/theming/sandbox/1/drift/index.html", { session: "admin" }, FRAME);
      expect(res.statusCode).toBe(200);
      expect(res.headers).not.toHaveProperty("set-cookie");
    });

    it.each([
      ["opened on its own", { "sec-fetch-dest": "document", "sec-fetch-site": "none" }],
      ["loaded as a script", { "sec-fetch-dest": "script", "sec-fetch-site": "same-origin" }],
      ["loaded as a worker", { "sec-fetch-dest": "worker", "sec-fetch-site": "same-origin" }],
      ["without fetch metadata", {}],
    ])("is refused when %s, with an empty body that paints nothing", async (_, headers) => {
      const res = await get(h, "/theming/sandbox/1/drift/index.html", {}, headers);
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe("");
      expect(res.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
      expect(res.headers["cache-control"]).toBe("no-store");
    });

    it("keeps an entry in a subfolder to its embed's folder", async () => {
      const res = await get(h, "/theming/sandbox/1/nested/pages/main.html", {}, FRAME);
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-security-policy"]).toContain(
        "script-src http://alpha.test/theming/sandbox/1/nested/;",
      );
    });
  });

  describe("an embed's other files", () => {
    it("are served to the sandbox's own cross-site requests, with their type", async () => {
      const js = await get(h, "/theming/sandbox/1/drift/drift.js", {}, FROM_SANDBOX);
      expect(js.statusCode).toBe(200);
      expect(js.headers["content-type"]).toBe("text/javascript; charset=utf-8");
      expect(js.headers["content-security-policy"]).toBe(POLICY);
      expect(js.body).toBe(drift.files["embeds/drift/drift.js"]?.toString());
      const json = await get(h, "/theming/sandbox/1/nested/data/points.json", {}, FROM_SANDBOX);
      expect(json.headers["content-type"]).toBe("application/json");
      const css = await get(h, "/theming/sandbox/1/nested/look.css", {}, FROM_SANDBOX);
      expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
    });

    it.each([
      ["same-origin", { "sec-fetch-dest": "script", "sec-fetch-site": "same-origin" }],
      ["same-site", { "sec-fetch-dest": "script", "sec-fetch-site": "same-site" }],
      ["typed into the address bar", { "sec-fetch-dest": "document", "sec-fetch-site": "none" }],
      ["without fetch metadata", {}],
    ])("are refused to a %s request", async (_, headers) => {
      const res = await get(h, "/theming/sandbox/1/drift/drift.js", {}, headers);
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe("");
    });

    it("never serve the entry as a file, nor a file as the entry", async () => {
      const entry = await get(h, "/theming/sandbox/1/drift/index.html", {}, FROM_SANDBOX);
      expect(entry.statusCode).toBe(404);
      const js = await get(h, "/theming/sandbox/1/drift/drift.js", {}, FRAME);
      expect(js.statusCode).toBe(404);
    });
  });

  describe("what the sandbox does not serve", () => {
    it.each([
      ["an unknown embed", "/theming/sandbox/1/nope/index.html"],
      ["an unknown file", "/theming/sandbox/1/drift/other.html"],
      ["an unknown revision", "/theming/sandbox/2/drift/index.html"],
      ["revision 0", "/theming/sandbox/0/drift/index.html"],
      ["a bad embed name", "/theming/sandbox/1/Drift/index.html"],
      ["a file of another embed", "/theming/sandbox/1/nested/drift.js"],
    ])("%s", async (_, url) => {
      const res = await get(h, url, {}, FRAME);
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe("");
      expect(res.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    });

    // inject() and browsers resolve dot segments first; a raw client need not, so this goes
    // over a socket.
    it.each(["../nested/look.css", "%2e%2e/nested/look.css"])(
      "refuses the dot segments of a raw request (%s)",
      async (rest) => {
        const res = await raw(h, `/theming/sandbox/1/drift/${rest}`, FROM_SANDBOX);
        expect(res.status).toBe(400);
        expect(res.body).toBe("");
        expect(res.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
      },
    );

    it("never serves another event's embed", async () => {
      const res = await get(h, "/theming/sandbox/1/drift/index.html", { host: "beta.test" }, FRAME);
      expect(res.statusCode).toBe(404);
    });

    it("never serves an embed's files outside the sandbox", async () => {
      for (const [path, ext] of [
        ["embeds/drift/index.html", "html"],
        ["embeds/drift/drift.js", "js"],
        ["embeds/nested/look.css", "css"],
      ] as const) {
        const stored = sha256(drift.files[path] ?? NESTED.files[path] ?? Buffer.alloc(0));
        expect((await get(h, `/theming/a/${stored}.${ext}`)).statusCode).toBe(404);
      }
    });
  });

  describe("draft embeds", () => {
    const KEY = "k".repeat(43);
    it("are served under the draft's key, never cached", async () => {
      const res = await get(
        h,
        `/theming/sandbox/draft/${KEY}/drift/index.html`,
        { host: "beta.test" },
        FRAME,
      );
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["content-security-policy"]).toContain(
        `script-src http://beta.test/theming/sandbox/draft/${KEY}/drift/;`,
      );
    });

    it("are refused under any other key, and to another event", async () => {
      const wrong = await get(
        h,
        `/theming/sandbox/draft/${"j".repeat(43)}/drift/index.html`,
        { host: "beta.test" },
        FRAME,
      );
      expect(wrong.statusCode).toBe(404);
      const other = await get(h, `/theming/sandbox/draft/${KEY}/drift/index.html`, {}, FRAME);
      expect(other.statusCode).toBe(404);
    });
  });

  describe("the current theme", () => {
    it("lists each embed with its frame address", async () => {
      const res = await get(h, "/api/theming/current");
      const body = res.json<{ embeds: { name: string; frame_url: string }[] }>();
      expect(body.embeds).toEqual([
        { name: "drift", frame_url: "/theming/sandbox/1/drift/index.html" },
        { name: "nested", frame_url: "/theming/sandbox/1/nested/pages/main.html" },
      ]);
    });
  });

  describe("storing an embed", () => {
    const html = Buffer.from("<!doctype html>");
    it.each([
      ["a file outside its folder", "embeds/x/index.html", { "embeds/y/a.js": Buffer.from("") }],
      ["HTML besides the entry", "embeds/x/index.html", { "embeds/x/other.html": html }],
      ["an entry that is no HTML", "embeds/x/a.js", {}],
      ["an entry missing from its files", "embeds/x/gone.html", {}],
      ["a file type no embed has", "embeds/x/index.html", { "embeds/x/run.sh": Buffer.from("") }],
    ])("refuses %s", async (_, entry, files) => {
      const all = { "embeds/x/index.html": html, "embeds/x/a.js": Buffer.from(""), ...files };
      await expect(
        seedEmbeds(h, "gamma", { revision: 1 }, { x: { entry, files: all } }),
      ).rejects.toThrow(/embed x/);
    });
  });

  describe("the API", () => {
    it("refuses Origin: null, what a sandboxed document sends", async () => {
      const res = await h.app.inject({
        method: "GET",
        url: "/api/theming/current",
        headers: { host: "alpha.test", origin: "null" },
      });
      expect(res.statusCode).toBe(403);
      expect(code(res)).toBe("origin_refused");
    });
  });
});

describe.skipIf(!DATABASE_URL)("the sandbox in IP mode", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness({ ipMode: true });
    await seedEmbeds(h, "alpha", { revision: 1 }, { drift: await demoEmbed("level-up", "drift") });
  });
  afterAll(async () => {
    await h.close();
  });

  // Over plain http browsers send fetch metadata only to localhost (contracts/theming.md).
  it("serves without fetch metadata, still with the sandbox CSP", async () => {
    const entry = await get(h, "/theming/sandbox/1/drift/index.html");
    expect(entry.statusCode).toBe(200);
    expect(entry.headers["content-security-policy"]).toBe(POLICY);
    const js = await get(h, "/theming/sandbox/1/drift/drift.js");
    expect(js.statusCode).toBe(200);
  });
});
