/**
 * The layout gallery's note on Dashboard's statistics (src/studio/layout-views.ts; #416, #488): it
 * says the statistics boxes give their space away only while the zone, as set, leaves one of them
 * waiting. The zone's own widgets for a box, its `idle` opt-out and Hide this box keep it from
 * waiting (contracts/screen.md, Boxes waiting for their source).
 */
import { describe, expect, it } from "vitest";
import { BUILT_IN_LAYOUTS } from "../src/compose/layouts.js";
import { layoutGallery } from "../src/studio/layout-views.js";
import { translator } from "../src/studio/messages.js";
import type { ViewContext } from "../src/studio/views.js";

const c: ViewContext = {
  t: translator("en"),
  rights: new Set(),
  nowMs: 0,
  timeZone: "UTC",
  startUrl: null,
};
// Dashboard's four boxes of statistics only (the hero and the rail show other things).
const STATS = ["online", "voice", "top_games", "right_now"];
const note = (regions: Record<string, Record<string, unknown>>) =>
  String(layoutGallery(c, BUILT_IN_LAYOUTS, "dashboard", regions)).includes("data-statistics-note");
const each = (setting: Record<string, unknown>) =>
  Object.fromEntries(STATS.map((id) => [id, setting]));

describe("the gallery's note on statistics", () => {
  it("is there while the zone leaves a box of statistics waiting", () => {
    expect(note({})).toBe(true);
    expect(note({ ...each({ idle: "blank" }), online: {} })).toBe(true);
  });

  it("is not there once the zone keeps every such box drawn or out of the way", () => {
    expect(note(each({ idle: "blank" }))).toBe(false);
    expect(note(each({ idle: "next" }))).toBe(false);
    expect(note(each({ widgets: [{ widget: "clock" }] }))).toBe(false);
    expect(note(each({ hidden: true }))).toBe(false);
  });

  it("is never there for a layout without statistics boxes", () => {
    expect(
      String(layoutGallery(c, BUILT_IN_LAYOUTS, "pulse", {})).includes("data-statistics-note"),
    ).toBe(false);
  });
});
