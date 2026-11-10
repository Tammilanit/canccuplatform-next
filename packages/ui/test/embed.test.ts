import { describe, expect, it } from "vitest";
import { embedWidget } from "../src/embed.js";

const s = (h: { toString(): string }): string => h.toString();
const FRAME = "/theming/sandbox/3/drift/index.html";

describe("embedWidget", () => {
  it("frames the embed only with the contract's sandbox, over the still", () => {
    expect(s(embedWidget({ frameUrl: FRAME, logoUrl: "/theming/a/logo.svg" }))).toBe(
      '<div class="canccu-widget canccu-widget--embed">' +
        '<div class="canccu-widget__body"><img src="/theming/a/logo.svg" alt=""></div>' +
        '<iframe class="canccu-embed" sandbox="allow-scripts" allow="" referrerpolicy="no-referrer"' +
        ` src="${FRAME}" title="" aria-hidden="true" tabindex="-1"></iframe>` +
        "</div>",
    );
  });

  it("never grants the frame the event's origin", () => {
    const out = s(embedWidget({ frameUrl: FRAME }));
    expect(out).not.toContain("allow-same-origin");
    expect(out.match(/sandbox="([^"]*)"/)?.[1]).toBe("allow-scripts");
  });

  it("shows the still alone without an embed to frame", () => {
    expect(s(embedWidget({ logoUrl: "/theming/a/logo.svg" }))).toBe(
      '<div class="canccu-widget canccu-widget--embed">' +
        '<div class="canccu-widget__body"><img src="/theming/a/logo.svg" alt=""></div>' +
        "</div>",
    );
  });

  it("keeps the still the theme's background without a logo", () => {
    expect(s(embedWidget({ frameUrl: FRAME }))).toContain(
      '<div class="canccu-widget__body"></div>',
    );
  });

  it.each([
    ["another path on the event's hostname", "/admin/settings"],
    ["another origin", "https://example.com/theming/sandbox/1/x/index.html"],
    ["a protocol-relative address", "//example.com/theming/sandbox/1/x/index.html"],
    ["a script address", "javascript:alert(1)"],
    ["a path that climbs out", "/theming/sandbox/../admin/settings"],
  ])("frames nothing but a sandbox address: not %s", (_, frameUrl) => {
    expect(s(embedWidget({ frameUrl }))).not.toContain("<iframe");
  });
});
