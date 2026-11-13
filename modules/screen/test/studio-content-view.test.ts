/**
 * The Content page's drawing on its own (#263; mockup 10): a sound's short card, a deck's strip of
 * at most three slides and a "+N" tile, the font warning's wording, the storage bar and the one
 * drop band with its link line.
 */
import { describe, expect, it } from "vitest";
import { renderPart, slideRuns, warningText } from "../src/studio/content-render.js";
import type { DeckJob } from "../src/studio/content-render.js";
import { contentView } from "../src/studio/content-view.js";
import type { ContentAsset, ContentData } from "../src/studio/content-view.js";
import { translator } from "../src/studio/messages.js";
import type { ViewContext } from "../src/studio/views.js";

const t = translator("en");
const ctx = (rights: string[] = ["screen.content.read", "screen.content.write"]): ViewContext => ({
  t,
  rights: new Set(rights),
  nowMs: 0,
  timeZone: "UTC",
  startUrl: null,
});
const asset = (over: Partial<ContentAsset>): ContentAsset => ({
  id: "a1",
  kind: "image",
  title: "poster.png",
  version: 1,
  url: "/files/poster.png",
  size_bytes: 2048,
  duration_seconds: null,
  health: "ok",
  health_message: null,
  can_revert: false,
  used_by: [],
  ...over,
});
const data = (assets: ContentAsset[], webOn = true): ContentData => ({
  assets,
  next: null,
  jobs: new Map(),
  query: { q: "", kind: "", after: "" },
  webOn,
  index: {},
});
const slides = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ index: i + 1, width: 1920, height: 1080, bytes: 1 }));
const done = (n: number, warnings: DeckJob["warnings"] = []): DeckJob => ({
  id: "j1",
  asset_version: 1,
  state: "succeeded",
  position: null,
  slides_done: n,
  slides: slides(n),
  warnings,
  error_message: null,
});
const font = (on: number[]) => ({
  code: "font_missing",
  font: "Brand Sans",
  slides: on,
  message: "",
});

describe("a sound's card", () => {
  it("has the note, its length and a play button, and no picture tile", () => {
    const sound = asset({
      kind: "audio",
      title: "chime.ogg",
      url: "/f/chime.ogg",
      duration_seconds: 2,
    });
    const body = String(contentView(ctx(), data([sound])));
    const card = body.slice(body.indexOf('id="asset-a1"'));
    expect(card).toContain("canccu-studio-sound");
    expect(card).toContain("♪");
    expect(card).toContain("0:02");
    expect(card).toContain('data-play="/f/chime.ogg"');
    expect(card).not.toContain("canccu-studio-asset__preview");
    // The length is on the play row once, not again in the details line.
    expect(card.match(/0:02/g)).toHaveLength(1);
  });
});

describe("a rendered deck's strip", () => {
  it("shows at most three slides, then a +N tile for the rest", () => {
    const part = String(renderPart(ctx(), { id: "d1", title: "Keynote" }, done(6)));
    expect(part.match(/<img/g)).toHaveLength(3);
    expect(part).toContain("slide-3.png");
    expect(part).not.toContain("slide-4.png");
    expect(part).toContain('aria-label="3 more slides"');
    expect(part).toMatch(/>\s*\+3\s*</);
    expect(part).toContain("6 slides");
  });

  it("has no tile when every slide fits", () => {
    const part = String(renderPart(ctx(), { id: "d1", title: "Keynote" }, done(3)));
    expect(part.match(/<img/g)).toHaveLength(3);
    expect(part).not.toContain("canccu-studio-slides__more");
    expect(String(renderPart(ctx(), { id: "d1", title: "K" }, done(4)))).toContain("1 more slide");
  });
});

describe("the font warning", () => {
  it("says all N slides when every slide uses the stand-in", () => {
    expect(warningText(t, font([1, 2, 3, 4, 5, 6]), 6)).toBe(
      "Brand Sans is not in the renderer: all 6 slides use a stand-in font.",
    );
  });

  it("writes slides in order as a range, and the rest one by one", () => {
    expect(warningText(t, font([2, 3, 4, 5]), 6)).toBe(
      "Brand Sans is not in the renderer: slides 2–5 use a stand-in font.",
    );
    expect(slideRuns([9, 1, 2, 4, 5, 6, 2])).toBe("1–2, 4–6, 9");
    expect(warningText(t, font([2]), 6)).toBe(
      "Brand Sans is not in the renderer: slide 2 uses a stand-in font.",
    );
    expect(warningText(t, font([1]), 1)).toBe(
      "Brand Sans is not in the renderer: slide 1 uses a stand-in font.",
    );
  });

  it("keeps the renderer's own words for other warnings", () => {
    expect(warningText(t, { code: "other", font: null, slides: [], message: "Hm." }, 2)).toBe(
      "Hm.",
    );
  });
});

describe("the page's head and drop band", () => {
  it("draws storage as a meter bar, not a native meter", () => {
    const body = String(contentView(ctx(), data([])));
    expect(body).toContain('role="meter"');
    expect(body).toContain("canccu-studio-storage__fill");
    expect(body).not.toContain("<meter");
  });

  it("is one band: files on its first line, the link field on its second while web is on", () => {
    const on = String(contentView(ctx(), data([])));
    const band = on.slice(on.indexOf("canccu-studio-drop"), on.indexOf("data-upload-plan"));
    expect(band).toContain("Choose files");
    expect(band).toContain("data-add-link");
    expect(band).toContain('placeholder="Paste a web or YouTube link"');
    expect(on).not.toContain("<details");
    const off = String(contentView(ctx(), data([], false)));
    expect(off).toContain("Choose files");
    expect(off).not.toContain("data-add-link");
    expect(String(contentView(ctx(["screen.content.read"]), data([])))).not.toContain(
      "data-upload",
    );
  });
});
