// @vitest-environment happy-dom
// The window editor while a call runs (#543, static/studio-schedule.js): Save, the armed Delete and
// a drag on the grid do nothing until the call has answered, so a double tap or a drag made during
// a slow save cannot send a second POST, DELETE or PUT and create a duplicate window.
import type { Element, HTMLButtonElement, HTMLElement, HTMLFormElement, Window } from "happy-dom";
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
  agenda_item_id: null,
  days: [4],
  start_minute: 1080,
  end_minute: 1140,
  revision: 3,
};

type Answer = { ok: boolean; status: number };
let api: ReturnType<typeof vi.fn>;
let answer: (a: Answer) => void;
const reloadWith = vi.fn();
const SCRIPT = "../static/studio-schedule.js";

beforeEach(async () => {
  document.body.innerHTML = `
    <dialog id="canccu-sched-editor" data-zone="main">
      <form data-window-form>
        <h2 id="canccu-sched-editor-title" data-new="New" data-edit="Edit"></h2>
        <input type="hidden" name="id" /><input type="hidden" name="revision" />
        <select name="zone_key"><option value="main">Main</option></select>
        <select name="playlist_id"><option value="p1">Loop</option></select>
        <input name="priority" value="10" />
        <select name="layout_id"><option value="">Zone's</option></select>
        <input type="radio" name="kind" value="weekly" checked /><input type="radio" name="kind" value="bound" />
        <input type="checkbox" name="days" value="4" /><input type="checkbox" name="days" value="5" />
        <input name="start" /><input name="end" />
        <select name="agenda_item_id"><option value="">Pick</option></select>
        <p data-window-error hidden></p>
        <button type="button" data-window-delete data-confirm="Sure?">Delete</button>
        <button type="submit">Save</button>
      </form>
    </dialog>
    <button data-window-edit="w1">Edit window</button>
    <script type="application/json" id="canccu-sched-windows">${JSON.stringify({ schedules: [WINDOW] })}</script>
    <div class="canccu-sched__grid" data-axis="0 1440">
      <section data-date="2026-01-01">
        <div class="canccu-sched__body">
          <div class="canccu-sched__lane" data-zone="main">
            <div data-window="w1" data-drag>Window</div>
          </div>
        </div>
      </section>
    </div>`;
  const body = document.querySelector(".canccu-sched__body") as HTMLElement;
  body.getBoundingClientRect = () => new DOMRect(0, 0, 100, 1440);
  const grid = document.querySelector(".canccu-sched__grid") as HTMLElement;
  grid.setPointerCapture = () => {};
  const dialog = document.getElementById("canccu-sched-editor") as unknown as {
    showModal: () => void;
    close: () => void;
  };
  dialog.showModal = () => {};
  dialog.close = () => {};
  // happy-dom's radio group has no `value` setter, which browsers have and the script uses.
  const form = document.querySelector("form") as unknown as HTMLFormElement;
  const group = Object.getPrototypeOf(form.elements.namedItem("kind")) as object;
  type Radios = Iterable<{ value: string; checked: boolean }>;
  Object.defineProperty(group, "value", {
    configurable: true,
    get(this: Radios) {
      return [...this].find((radio) => radio.checked)?.value ?? "";
    },
    set(this: Radios, v: string) {
      for (const radio of this) radio.checked = radio.value === v;
    },
  });
  // Each call waits until the test answers it.
  api = vi.fn(() => new Promise<Answer>((resolve) => (answer = resolve)));
  reloadWith.mockClear();
  Object.assign(page, {
    canccuStudio: {
      api,
      failure: () => "refused",
      reloadWith,
      say: (k: string) => k,
      show: vi.fn(),
    },
  });
  vi.resetModules();
  await import(/* @vite-ignore */ SCRIPT);
});

afterEach(() => {
  document.body.innerHTML = "";
});

const $ = (selector: string) => document.querySelector(selector) as HTMLElement;
const save = () => $("button[type=submit]") as unknown as HTMLButtonElement;
const remove = () => $("[data-window-delete]") as unknown as HTMLButtonElement;
const submit = () =>
  ($("form[data-window-form]") as unknown as HTMLFormElement).dispatchEvent(
    new page.Event("submit", { cancelable: true }),
  );
const pointer = (target: Element, type: string, clientY: number, buttons: number) =>
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, pointerType: "mouse", button: 0, buttons, clientY }),
  );
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the window editor while a call runs", () => {
  it("sends one save for a double Save, and takes Save again after a refusal", async () => {
    $("[data-window-edit]").click();
    submit();
    submit();
    expect(api).toHaveBeenCalledTimes(1);
    expect(save().disabled).toBe(true);
    expect(remove().disabled).toBe(true);
    answer({ ok: false, status: 400 });
    await settle();
    expect(save().disabled).toBe(false);
    expect(remove().disabled).toBe(false);
    submit();
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("says so and takes Save again after the network drops", async () => {
    api.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    $("[data-window-edit]").click();
    submit();
    await settle();
    expect(save().disabled).toBe(false);
    expect(remove().disabled).toBe(false);
    const error = $("[data-window-error]");
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe("error.failed");
    submit();
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("keeps everything off after a save that reloads the page", async () => {
    $("[data-window-edit]").click();
    submit();
    answer({ ok: true, status: 200 });
    await settle();
    expect(reloadWith).toHaveBeenCalledTimes(1);
    expect(save().disabled).toBe(true);
    submit();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("sends one delete for more taps on the armed Delete", () => {
    $("[data-window-edit]").click();
    remove().click();
    remove().click();
    remove().click();
    remove().click();
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]?.[0]).toBe("DELETE");
  });

  it("ignores a drag on the grid while a save runs", () => {
    $("[data-window-edit]").click();
    submit();
    const block = $("[data-window]");
    pointer(block, "pointerdown", 100, 1);
    pointer(block, "pointermove", 160, 1);
    pointer(block, "pointerup", 160, 0);
    expect(api).toHaveBeenCalledTimes(1);
  });
});
