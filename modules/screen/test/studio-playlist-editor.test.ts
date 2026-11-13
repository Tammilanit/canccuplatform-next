// @vitest-environment happy-dom
/**
 * The playlist editor's rows as drawn in the browser (static/studio-playlist-editor.js). An image
 * in a slideshow has no fields of its own, and its row must not show the "null" that
 * `Element.append` makes of a missing node.
 */
import type { Window } from "happy-dom";
import { beforeAll, describe, expect, it } from "vitest";
import type { builder as Builder } from "../static/studio-playlist-editor.js";

// The module's types are the server's (no DOM lib); the browser here is happy-dom's.
const win = globalThis as unknown as Window;
let builder: typeof Builder;

beforeAll(async () => {
  // The editor takes studio.js's helpers from the page; only the drawing is under test here.
  Object.assign(win, {
    canccuStudio: {
      api: () => Promise.resolve(null),
      confirmed: () => true,
      failure: () => "",
      reloadWith: () => undefined,
      say: (key: string) => key,
      show: () => undefined,
    },
  });
  ({ builder } = await import("../static/studio-playlist-editor.js"));
});

const LIBRARY = {
  poster: {
    kind: "image",
    title: "poster.png",
    duration_seconds: null,
    slides: null,
    health: "ok",
  },
};
const playlist = (type: string, extra: object = {}) => ({
  id: "pl_1",
  name: "Welcome loop",
  type,
  priority: 0,
  revision: 1,
  slideshow_image_seconds: null,
  windows: 0,
  items: [{ id: "it_1", asset_id: "poster", duration_seconds: null, slide_start: null }],
  ...extra,
});

describe("the editor's item rows", () => {
  for (const [name, doc] of [
    ["a slideshow", playlist("slideshow")],
    ["a break in slideshow mode", playlist("break", { break: { mode: "slideshow" } })],
    [
      "an item whose asset is gone",
      playlist("regular", { items: [{ id: "it_1", asset_id: "x" }] }),
    ],
  ] as const) {
    it(`shows no literal "null" in the item row of ${name}`, () => {
      const box = win.document.createElement("div");
      builder(box, doc, true, LIBRARY);
      const row = box.querySelector("li.canccu-studio-item");
      expect(row).not.toBeNull();
      expect(row?.textContent).not.toContain("null");
      expect(row?.querySelector(".canccu-studio-item__tools")).not.toBeNull();
    });
  }
});
