import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, call, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

describe.skipIf(!DATABASE_URL)("the /screen/ page and its bundle", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });

  it("serves the loader for the platform's bundle version, never cached", async () => {
    const res = await call(h, "GET", "/screen/");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html; charset=utf-8/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain('<script type="module" src="/screen/b/test/player.js"></script>');
    expect(res.body).toContain('<link rel="stylesheet" href="/screen/b/test/player.css">');
    expect(res.body).toContain('class="canccu-page canccu-surface canccu-surface--screen"');
    expect(res.body).toContain('data-bundle="test"');
  });

  it("carries the event page CSP of the request's own host, with no inline script", async () => {
    const res = await call(h, "GET", "/screen/");
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-src http://alpha.test/theming/sandbox/");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(res.body).not.toMatch(/<script(?![^>]*\ssrc=)/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("frames the event's web pages and YouTube's embeds, and nothing a list entry could smuggle in", async () => {
    h.settings.alpha = {
      web_allowlist: [
        "https://info.example/board",
        "https://menu.example",
        "http://plain.example",
        "https://bad.example; script-src *",
        "not a url",
      ],
    };
    const res = await call(h, "GET", "/screen/");
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain(
      "frame-src http://alpha.test/theming/sandbox/ https://www.youtube-nocookie.com https://info.example https://menu.example;",
    );
    expect(csp).not.toContain("plain.example");
    expect(csp.match(/script-src/g)).toHaveLength(1);
    h.settings.alpha = {};
  });

  it("serves the page to a host written with a trailing dot", async () => {
    const res = await call(h, "GET", "/screen/", { host: "alpha.test." });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-security-policy"])).toContain("script-src 'self'");
  });

  it("sends the bare path on to the page", async () => {
    const res = await call(h, "GET", "/screen?x=1");
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe("/screen/?x=1");
  });

  it("serves its own version's files as immutable", async () => {
    const js = await call(h, "GET", "/screen/b/test/player.js");
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(js.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(js.body).toBe("export {};\n");
    const css = await call(h, "GET", "/screen/b/test/player.css");
    expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
  });

  it("answers 404 for another version or any other file", async () => {
    for (const path of [
      "/screen/b/0.0.1/player.js",
      "/screen/b/test/other.js",
      "/screen/b/test/player.js.map",
    ]) {
      const res = await call(h, "GET", path);
      expect(res.statusCode, path).toBe(404);
    }
  });

  it("is only an event's page: a platform hostname gets 404", async () => {
    const res = await call(h, "GET", "/screen/", { host: "unknown.test" });
    expect(res.statusCode).toBe(404);
  });
});
