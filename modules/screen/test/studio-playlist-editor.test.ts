// @vitest-environment happy-dom
/**
 * The playlist editor as drawn in the browser (static/studio-playlist-editor.js). An image in a
 * slideshow has no fields of its own, and its row must not show the "null" that `Element.append`
 * makes of a missing node. Save and a conflict's reload reopen the same playlist with the
 * library's search and page (#541); a row drags by its handle only; ↑ and ↓ keep the focus.
 */
import type { HTMLButtonElement, HTMLElement, HTMLInputElement, Window } from "happy-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { builder as Builder } from "../static/studio-playlist-editor.js";

// The module's types are the server's (no DOM lib); the browser here is happy-dom's.
const win = globalThis as unknown as Window;
let builder: typeof Builder;
// The editor takes studio.js's helpers as it loads, so each is one mock the tests steer.
const studio = {
  api: vi.fn((..._: unknown[]) => Promise.resolve({ ok: true, status: 200, data: null })),
  confirmed: () => true,
  failure: () => "",
  reloadWith: vi.fn(),
  say: (key: string) => key,
  counted: (key: string) => key,
  show: vi.fn(),
};

beforeAll(async () => {
  Object.assign(win, { canccuStudio: studio });
  ({ builder } = await import("../static/studio-playlist-editor.js"));
});

afterEach(() => {
  win.document.body.innerHTML = "";
  vi.clearAllMocks();
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

const regular = () =>
  playlist("regular", {
    items: ["it_1", "it_2", "it_3"].map((id) => ({
      id,
      asset_id: "poster",
      duration_seconds: 10,
      slide_start: null,
      slide_end: null,
      slide_seconds: null,
    })),
  });
/** The editor in the page, for a writer, with the library searched and paged in the address. */
function editor(doc: ReturnType<typeof playlist>) {
  win.happyDOM.setURL("http://localhost/admin/screen/content?q=post&kind=image&after=c_9");
  const box = win.document.createElement("div");
  win.document.body.append(box);
  builder(box, doc, true, LIBRARY);
  return box;
}
const rowsOf = (box: HTMLElement) => [...box.querySelectorAll("li.canccu-studio-item")];
const reopened = (url: unknown) => {
  const u = new URL(String(url), "http://localhost");
  return [u.pathname, Object.fromEntries(u.searchParams)];
};
const SAME = [
  "/admin/screen/content",
  { playlist: "pl_1", q: "post", kind: "image", after: "c_9" },
];

describe("saving", () => {
  const edit = (box: HTMLElement) => {
    const name = box.querySelector(".canccu-studio-builder__settings input") as HTMLInputElement;
    name.value = "Renamed";
    name.dispatchEvent(new win.Event("input"));
  };
  const save = (box: HTMLElement) =>
    [...box.querySelectorAll("button")].find((b) => b.textContent === "playlist.save");

  it("reopens this playlist, with the library's search and page", async () => {
    const box = editor(regular());
    edit(box);
    save(box)?.click();
    await vi.waitFor(() => expect(studio.reloadWith).toHaveBeenCalled());
    expect(studio.reloadWith.mock.calls[0]?.[0]).toBe("playlist.saved");
    expect(reopened(studio.reloadWith.mock.calls[0]?.[1])).toEqual(SAME);
  });

  it("reloads this playlist, with the library's search and page, after a conflict", async () => {
    studio.api.mockResolvedValueOnce({
      ok: false,
      status: 409,
      data: { error: { code: "version_conflict" } },
    } as never);
    const assign = vi.spyOn(win.location, "assign").mockImplementation(() => undefined);
    const box = editor(regular());
    edit(box);
    save(box)?.click();
    await vi.waitFor(() => expect(studio.show).toHaveBeenCalled());
    (studio.show.mock.calls[0]?.[1] as HTMLButtonElement).click();
    expect(reopened(assign.mock.calls[0]?.[0])).toEqual(SAME);
    assign.mockRestore();
  });
});

describe("dragging a row", () => {
  const dragStart = (target: HTMLElement) => {
    const data = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "none" };
    const event = new win.Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: data });
    target.dispatchEvent(event);
    return data.setData;
  };

  it("starts at its handle only, so text in its fields can be selected", () => {
    const [row] = rowsOf(editor(regular())) as HTMLElement[];
    const handle = row?.querySelector(".canccu-studio-item__handle") as HTMLElement;
    expect(row?.draggable).not.toBe(true);
    expect(handle.draggable).toBe(true);
    expect(dragStart(row?.querySelector("input") as HTMLElement)).not.toHaveBeenCalled();
    expect(dragStart(handle)).toHaveBeenCalledWith("application/x-canccu-item", "0");
  });
});

describe("the arrow buttons", () => {
  const arrow = (row: unknown, label: string) =>
    // By its title: happy-dom keeps `ariaLabel` as a property only, not as the attribute.
    (row as HTMLElement).querySelector(`button[title='${label}']`) as HTMLButtonElement;

  it("keep the focus on the moved row's arrow", () => {
    const box = editor(regular());
    const down = arrow(rowsOf(box)[0], "playlist.move_down");
    down.focus();
    down.click();
    const moved = rowsOf(box)[1];
    expect(moved?.querySelector(".canccu-studio-item__title")?.textContent).toBe("poster.png");
    expect(win.document.activeElement).toBe(arrow(moved, "playlist.move_down"));
    arrow(moved, "playlist.move_up").click();
    expect(win.document.activeElement).toBe(arrow(rowsOf(box)[0], "playlist.move_down"));
  });
});
