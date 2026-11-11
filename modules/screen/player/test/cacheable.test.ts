import { describe, expect, it } from "vitest";
import { cssFiles, isImmutable, namedFiles } from "../src/cacheable.js";

describe("what a screen keeps offline", () => {
  it("is only files under immutable addresses", () => {
    for (const path of [
      "/screen/b/1.2.3/player.js",
      "/theming/a/3f9c.css",
      "/theming/sandbox/7/clock/index.html",
      "/theming/sandbox/7/clock/assets/app.js",
      "/api/screen/files/ab12.mp4",
      "/api/screen/renders/as_1/2/3",
    ]) {
      expect(isImmutable(path), path).toBe(true);
    }
    for (const path of [
      "/screen/",
      "/api/screen/device/state",
      // A draft's embed changes under the same address.
      "/theming/sandbox/draft/k1/clock/index.html",
      "/theming/draft/3f9c.css",
      "/api/theming/current",
    ]) {
      expect(isImmutable(path), path).toBe(false);
    }
  });

  it("finds every file a state names, wherever it is, and its prefetch list", () => {
    const state = {
      theme: { tokens_css_url: "/theming/a/t1.css", css_url: null, logo_url: "/theming/a/l.png" },
      regions: [
        {
          widgets: [
            { view: { items: [{ url: "/api/screen/files/v1.mp4?x=1" }], qr: "data:image/svg" } },
            { view: { url: "https://alpha.test/api/screen/files/p1.jpg", phone: "/notify/" } },
            { view: { url: "https://elsewhere.test/api/screen/files/p2.jpg" } },
          ],
        },
      ],
      prefetch: ["/theming/sandbox/7/clock/index.html", "//evil.test/theming/a/x.css"],
    };
    expect(namedFiles(state, "https://alpha.test").sort()).toEqual([
      "/api/screen/files/p1.jpg",
      "/api/screen/files/v1.mp4",
      "/theming/a/l.png",
      "/theming/a/t1.css",
      "/theming/sandbox/7/clock/index.html",
    ]);
  });

  it("finds the fonts and images a style sheet names", () => {
    const css = `@font-face{src:url("/theming/a/f1.woff2") format("woff2")}
      .a{background:url(/theming/a/bg.webp)} .b{background:url('//evil.test/theming/a/x.png')}
      .c{background:url(data:image/png;base64,AAA)}`;
    expect(cssFiles(css).sort()).toEqual(["/theming/a/bg.webp", "/theming/a/f1.woff2"]);
  });
});
