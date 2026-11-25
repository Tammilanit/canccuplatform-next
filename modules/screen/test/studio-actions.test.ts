// @vitest-environment happy-dom
/**
 * studio.js's buttons and the pair dialog (#539): a call that never reaches the server says so and
 * gives the button back, a destructive button asks again after it acted, and a pairing code
 * carried through sign-in opens the dialog.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HTMLButtonElement, HTMLElement, HTMLInputElement, Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const win = globalThis as unknown as Window;
const STUDIO_JS = readFileSync(join(import.meta.dirname, "../static/studio.js"), "utf8");
const SIGNIN_JS = readFileSync(join(import.meta.dirname, "../static/studio-signin.js"), "utf8");
const TEXT = { "error.failed": "That did not work. Try again." };

let calls: string[];
let answer: () => Promise<Response>;
// The document outlives each test, so the listeners a load adds are taken off after it.
let added: [string, (event: unknown) => void][] = [];

function load(body: string): void {
  win.document.body.innerHTML = `
    <script type="application/json" id="canccu-studio-text">${JSON.stringify(TEXT)}</script>
    <p class="canccu-studio-notice" role="status" hidden></p>${body}`;
  win.eval(STUDIO_JS);
}

const notice = () => win.document.querySelector(".canccu-studio-notice") as HTMLElement;
const button = () => win.document.querySelector("[data-call]") as unknown as HTMLButtonElement;

beforeEach(() => {
  calls = [];
  answer = () => Promise.resolve(new Response(null, { status: 204 }));
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      calls.push(url);
      return answer();
    }),
  );
  win.sessionStorage.clear();
  const add = win.document.addEventListener.bind(win.document);
  vi.spyOn(win.document, "addEventListener").mockImplementation(((
    type: string,
    listener: (event: unknown) => void,
  ) => {
    added.push([type, listener]);
    add(type, listener);
  }) as never);
});
afterEach(() => {
  for (const [type, listener] of added) win.document.removeEventListener(type, listener);
  added = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a Studio button", () => {
  it("is given back with a notice when the call never reaches the server", async () => {
    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    load(`<button data-call="POST" data-url="/api/screen/x" data-stay>Reload</button>`);
    button().click();
    await vi.waitFor(() => {
      expect(notice().hidden).toBe(false);
    });
    expect(notice().textContent).toBe(TEXT["error.failed"]);
    expect(button().disabled).toBe(false);
  });

  it("asks again after a confirmed action instead of repeating it", async () => {
    load(
      `<button data-call="DELETE" data-url="/api/screen/pairing" data-confirm="Tap again" data-stay data-done="Cleared">Clear codes</button>`,
    );
    button().click();
    expect(button().textContent).toBe("Tap again");
    expect(calls).toEqual([]);
    button().click();
    await vi.waitFor(() => {
      expect(notice().textContent).toBe("Cleared");
    });
    expect(calls).toHaveLength(1);
    expect(button().textContent).toBe("Clear codes");
    button().click();
    expect(button().textContent).toBe("Tap again");
    await Promise.resolve();
    expect(calls).toHaveLength(1);
  });
});

// The pair dialog's own script is static/studio-devices.js now (#783): studio-devices-script.test.ts.

describe("the way to sign in from Devices", () => {
  const secure = (value: boolean) => {
    Object.defineProperty(win, "isSecureContext", { value, configurable: true });
  };
  const notice = `<p data-insecure hidden>This address can't pair screens</p>`;

  it("keeps a scanned code for after sign-in, then goes to sign in", () => {
    secure(true);
    const replace = vi.spyOn(win.location, "replace").mockImplementation(() => undefined);
    win.history.replaceState(null, "", "/admin/screen/devices#pair=ab12-cd34");
    win.document.body.innerHTML = `<a href="/admin/sign-in?next=%2Fadmin%2Fscreen%2Fdevices" data-sign-in>Sign in</a>${notice}`;
    win.eval(SIGNIN_JS);
    expect(win.sessionStorage.getItem("canccu-studio-pair")).toBe("AB12CD34");
    expect(replace).toHaveBeenCalledWith(
      `${win.location.origin}/admin/sign-in?next=%2Fadmin%2Fscreen%2Fdevices`,
    );
  });

  it("keeps nothing without a code", () => {
    secure(true);
    vi.spyOn(win.location, "replace").mockImplementation(() => undefined);
    win.history.replaceState(null, "", "/admin/screen/devices");
    win.document.body.innerHTML = `<a href="/admin/sign-in" data-sign-in>Sign in</a>${notice}`;
    win.eval(SIGNIN_JS);
    expect(win.sessionStorage.getItem("canccu-studio-pair")).toBeNull();
  });

  it("over plain http, keeps the code and says to open https instead of a sign-in that loops (#783)", () => {
    secure(false);
    const replace = vi.spyOn(win.location, "replace").mockImplementation(() => undefined);
    win.history.replaceState(null, "", "/admin/screen/devices#pair=ab12-cd34");
    win.document.body.innerHTML = `<a href="/admin/sign-in" data-sign-in>Sign in</a>${notice}`;
    win.eval(SIGNIN_JS);
    expect(win.sessionStorage.getItem("canccu-studio-pair")).toBe("AB12CD34");
    expect(replace).not.toHaveBeenCalled();
    const shown = win.document.querySelector("[data-insecure]") as unknown as { hidden: boolean };
    expect(shown.hidden).toBe(false);
  });
});
