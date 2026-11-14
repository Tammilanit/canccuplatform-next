import { describe, expect, it } from "vitest";
import { translator } from "../src/studio/messages.js";
import { rotationPart } from "../src/studio/widget-settings.js";
import type { ViewContext } from "../src/studio/views.js";

// Screen studio's Director settings (contracts/screen.md, The Director; sheet 13, Q22).
const c: ViewContext = {
  t: translator("en"),
  rights: new Set(),
  nowMs: 0,
  timeZone: "UTC",
  startUrl: null,
};
const html = (settings: Record<string, unknown>, hero: boolean): string =>
  String(rotationPart(c, "f", settings, hero));
const selected = (page: string, name: string): string | undefined =>
  new RegExp(`name="${name}"[\\s\\S]*?<option value="([a-z]+)" selected`).exec(page)?.[1];

describe("the hero box's settings", () => {
  it("offers the Director first, with the turn indicator as a thin line by default", () => {
    const page = html({}, true);
    expect(selected(page, "rotation")).toBe("director");
    expect(selected(page, "indicator")).toBe("line");
    expect(page).toContain("A ring");
    expect(page).toContain("None");
  });

  it("shows what the zone saved", () => {
    const page = html({ rotation: "shuffle", indicator: "off" }, true);
    expect(selected(page, "rotation")).toBe("shuffle");
    expect(selected(page, "indicator")).toBe("off");
  });

  it("keeps the other boxes in order, with no indicator", () => {
    const page = html({}, false);
    expect(selected(page, "rotation")).toBe("sequence");
    expect(page).not.toContain('value="director"');
    expect(page).not.toContain('name="indicator"');
  });
});
