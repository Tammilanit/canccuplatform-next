// @vitest-environment happy-dom
/**
 * The Motion card's save (static/studio-motion.js, #487): the event's level saves first, then each
 * changed pin. When a pin then fails, the page stays, so it must carry the settings version the
 * event save answered: a retry neither saves the level again nor sends the stale version (a 409).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HTMLElement, HTMLFormElement, HTMLInputElement, Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const win = globalThis as unknown as Window;
const SCRIPT = readFileSync(join(import.meta.dirname, "../static/studio-motion.js"), "utf8");

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | undefined;
}
let calls: Call[];
let zonePutOk: boolean;
let shown: string[];

beforeEach(() => {
  calls = [];
  zonePutOk = false;
  shown = [];
  win.document.body.innerHTML = `
    <form data-motion data-version="7" data-pins='{"hall":null}'>
      <input type="radio" name="motion_level" value="calm">
      <input type="radio" name="motion_level" value="lively" checked>
      <input type="checkbox" name="follow_the_day" checked>
      <select name="pin.hall"><option value="">Follow</option><option value="party">Party</option></select>
      <button type="submit">Save motion</button>
    </form>`;
  const api = vi.fn((method: string, url: string, body?: Record<string, unknown>) => {
    calls.push({ method, url, body });
    if (url === "/api/screen/motion") {
      const version = (body?.settings_version as number) + 1;
      return Promise.resolve({ ok: true, status: 200, data: { settings_version: version } });
    }
    if (method === "GET") return Promise.resolve({ ok: true, status: 200, data: { key: "hall" } });
    return Promise.resolve(
      zonePutOk ? { ok: true, status: 200, data: {} } : { ok: false, status: 500, data: null },
    );
  });
  Object.assign(win, {
    canccuStudio: {
      api,
      failure: () => "failed",
      reloadWith: (message: string) => shown.push(`reload: ${message}`),
      say: (key: string) => key,
      show: (message: string) => shown.push(message),
    },
  });
  win.eval(SCRIPT);
});

const form = () => win.document.querySelector("form[data-motion]") as HTMLFormElement;
const choose = (level: string) => {
  for (const radio of form().querySelectorAll("[name=motion_level]"))
    (radio as HTMLInputElement).checked = (radio as HTMLInputElement).value === level;
};
const pin = (value: string) => {
  (form().elements.namedItem("pin.hall") as unknown as { value: string }).value = value;
};
async function submit() {
  (form().querySelector("button") as HTMLElement).click();
  await vi.waitFor(() => {
    expect(shown.length).toBeGreaterThan(0);
  });
}

describe("the Motion card's save", () => {
  it("keeps the version the event save answered when a pin then fails", async () => {
    choose("calm");
    pin("party");
    await submit();
    expect(shown).toEqual(["failed"]);
    expect(form().dataset.version).toBe("8");

    // Tried again as it stands: only the pin is left to save.
    shown = [];
    calls = [];
    zonePutOk = true;
    await submit();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/screen/zones/hall",
      "PUT /api/screen/zones/hall",
    ]);

    // A new level after that goes with the version the save answered.
    shown = [];
    calls = [];
    choose("lively");
    await submit();
    expect(calls[0]).toMatchObject({ url: "/api/screen/motion", body: { settings_version: 8 } });
  });
});
