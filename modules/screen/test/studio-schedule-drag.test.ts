// @vitest-environment happy-dom
// A drag on the Schedule page's grid (#267, static/studio-schedule.js) saves only a move someone
// made: a release the grid never hears, outside it or outside the browser, ends the drag there,
// so a later hover or click cannot carry it on into a PUT.
import type { Element, HTMLElement, Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The environment's globals, typed by happy-dom: this module's compiler has no DOM library.
const page = globalThis as unknown as Window;
const { document, DOMRect, PointerEvent } = page;

const WINDOW = {
  id: "w1",
  zone_key: "main",
  playlist_id: "p1",
  priority: 10,
  layout_id: null,
  days: [4],
  start_minute: 1080,
  end_minute: 1140,
  revision: 3,
};

let api: ReturnType<typeof vi.fn>;
const SCRIPT = "../static/studio-schedule.js";

beforeEach(async () => {
  document.body.innerHTML = `
    <dialog id="canccu-sched-editor" data-zone="main">
      <form data-window-form>
        <h2 id="canccu-sched-editor-title" data-new="New" data-edit="Edit"></h2>
        <p data-window-error hidden></p>
        <button type="button" data-window-delete data-confirm="Sure?">Delete</button>
      </form>
    </dialog>
    <script type="application/json" id="canccu-sched-windows">${JSON.stringify({ schedules: [WINDOW] })}</script>
    <div class="canccu-sched__grid" data-axis="0 1440">
      <section data-date="2026-01-01">
        <div class="canccu-sched__body">
          <div class="canccu-sched__lane" data-zone="main">
            <div data-window="w1" data-drag>Window</div>
          </div>
        </div>
      </section>
    </div>
    <div id="outside"></div>`;
  // One minute a pixel, from the top of the page.
  const body = document.querySelector(".canccu-sched__body") as HTMLElement;
  body.getBoundingClientRect = () => new DOMRect(0, 0, 100, 1440);
  const grid = document.querySelector(".canccu-sched__grid") as HTMLElement;
  grid.setPointerCapture = () => {};
  api = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
  Object.assign(page, {
    canccuStudio: {
      api,
      failure: () => "",
      reloadWith: vi.fn(),
      say: (k: string) => k,
      show: vi.fn(),
    },
  });
  // A fresh run of the page script per test, on this test's DOM. A plain script has no types, so
  // the path stays a value rather than a module the compiler would look up.
  vi.resetModules();
  await import(/* @vite-ignore */ SCRIPT);
});

afterEach(() => {
  document.body.innerHTML = "";
});

const block = () => document.querySelector("[data-window]") as HTMLElement;
const pointer = (target: Element, type: string, clientY: number, buttons: number) =>
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, pointerType: "mouse", button: 0, buttons, clientY }),
  );

describe("a drag on the schedule grid", () => {
  it("saves a window moved over the grid", () => {
    pointer(block(), "pointerdown", 100, 1);
    pointer(block(), "pointermove", 160, 1);
    expect(block().style.transform).toBe("translateY(60px)");
    pointer(block(), "pointerup", 160, 0);
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]?.[0]).toBe("PUT");
    expect(api.mock.calls[0]?.[2]).toMatchObject({ start_minute: 1140, end_minute: 1200 });
    expect(block().style.transform).toBe("");
  });

  it("ends at a release outside the grid, so a later drag over it moves nothing", () => {
    pointer(block(), "pointerdown", 100, 1);
    pointer(document.getElementById("outside") as Element, "pointerup", 102, 0);
    // A press that began outside the grid, dragged across the window and let go there.
    pointer(block(), "pointermove", 200, 1);
    expect(block().style.transform).toBe("");
    pointer(block(), "pointerup", 200, 0);
    expect(api).not.toHaveBeenCalled();
  });

  it("ends when the pointer moves with no button down, clearing the block's move", () => {
    pointer(block(), "pointerdown", 100, 1);
    pointer(block(), "pointermove", 160, 1);
    expect(block().style.transform).toBe("translateY(60px)");
    // The release went unheard (let go outside the browser): the next move has no button down.
    pointer(block(), "pointermove", 220, 0);
    expect(block().style.transform).toBe("");
    pointer(block(), "pointerup", 220, 0);
    expect(api).not.toHaveBeenCalled();
  });
});
