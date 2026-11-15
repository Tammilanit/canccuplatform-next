// @vitest-environment happy-dom
/**
 * "New playlist" on the Content page (static/studio-playlists.js, #541): a double click makes one
 * playlist, not two, since the button waits for the answer; a refusal gives it back.
 */
import type { HTMLButtonElement, HTMLInputElement, Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const win = globalThis as unknown as Window;
const { document } = win;
// A plain script has no types, so the path stays a value rather than a module to look up.
const SCRIPT = "../static/studio-playlists.js";
let answer: (r: unknown) => void;
const studio = {
  api: vi.fn(() => new Promise((resolve) => (answer = resolve))),
  confirmed: () => true,
  counted: (key: string) => key,
  failure: () => "refused",
  reloadWith: vi.fn(),
  say: (key: string) => key,
  show: vi.fn(),
};

beforeEach(async () => {
  vi.clearAllMocks();
  document.body.innerHTML = `
    <form data-playlist-new>
      <input name="name" value="Lobby loop" />
      <select name="type"><option value="regular" selected>Regular</option></select>
      <button type="submit">New playlist</button>
    </form>`;
  Object.assign(win, { canccuStudio: studio });
  vi.resetModules();
  await import(/* @vite-ignore */ SCRIPT);
});

const button = () => document.querySelector("form button") as HTMLButtonElement;
const submit = () =>
  document
    .querySelector("form")
    ?.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));

describe("New playlist", () => {
  it("sends one POST for a double click, the button off until the answer", async () => {
    submit();
    submit();
    expect(studio.api).toHaveBeenCalledTimes(1);
    expect(button().disabled).toBe(true);
    answer({ ok: true, status: 201, data: { id: "pl_9" } });
    await vi.waitFor(() => {
      expect(studio.reloadWith).toHaveBeenCalled();
    });
    expect(studio.reloadWith.mock.calls[0]?.[1]).toBe("/admin/screen/content?playlist=pl_9");
  });

  it("gives the button back after a refusal, with the reason", async () => {
    submit();
    answer({ ok: false, status: 400, data: null });
    await vi.waitFor(() => {
      expect(studio.show).toHaveBeenCalledWith("refused");
    });
    expect(button().disabled).toBe(false);
    (document.querySelector("[name=name]") as HTMLInputElement).value = "Lobby";
    submit();
    expect(studio.api).toHaveBeenCalledTimes(2);
  });
});
