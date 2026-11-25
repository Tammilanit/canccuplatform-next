// @vitest-environment happy-dom
/**
 * The Devices page's pairing script (static/studio-devices.js, #783): the QR's code opens the
 * dialog filled in, typing stays the fallback, each refusal is said in the dialog in plain words,
 * plain http is named, and a done pair opens the page on the new screen's panel.
 */
import type { HTMLDialogElement, HTMLElement, HTMLInputElement, Window } from "happy-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { cleanCode, pairErrorKey, pairing } from "../static/studio-devices.js";
import type { ApiAnswer } from "../static/studio-devices.js";

const WORDS: Record<string, string> = {
  "pair.done": "{device} is paired.",
  "pair.error.code": "That code is wrong or has expired.",
  "pair.error.format": "A code is the 8 letters and digits the screen shows.",
  "pair.error.no_venue": "This event has no venue yet.",
  "pair.error.zone": "That zone no longer exists.",
  "pair.error.offline": "Your phone or computer is offline.",
};
const say = (key: string, values: Record<string, unknown> = {}) =>
  (WORDS[key] ?? key).replace(/\{(\w+)\}/g, (_, n: string) => String(values[n]));
const refused = (status: number, code: string, message = ""): ApiAnswer => ({
  status,
  ok: false,
  data: { error: { code, message } },
});

describe("pairErrorKey", () => {
  it("names each refusal the dialog says in its own words", () => {
    expect(pairErrorKey(refused(400, "code_invalid"))).toBe("pair.error.code");
    expect(pairErrorKey(refused(400, "invalid_request", "`code` must be 8"))).toBe(
      "pair.error.format",
    );
    expect(pairErrorKey(refused(409, "no_venue"))).toBe("pair.error.no_venue");
    expect(pairErrorKey(refused(400, "unknown_zone"))).toBe("pair.error.zone");
    expect(pairErrorKey({ status: 0, ok: false, data: null })).toBe("pair.error.offline");
    // A name too long, a missing right: the server's own sentence says it.
    expect(pairErrorKey(refused(400, "invalid_request", "`name` is too long"))).toBeNull();
    expect(pairErrorKey(refused(403, "missing_right"))).toBeNull();
  });

  it("reads a typed or scanned code as letters and digits, upper case", () => {
    expect(cleanCode(" k7q4-9wxp ")).toBe("K7Q49WXP");
  });
});

const win = globalThis as unknown as Window;
const doc = win.document;

describe("the pair dialog", () => {
  let calls: { method: string; url: string; body: unknown }[];
  let answer: ApiAnswer;
  let went: { message: string; next: string | undefined }[];

  function run(hash = "", secure = true) {
    doc.body.innerHTML = `
      <div data-insecure hidden>This address can't pair screens</div>
      <button data-open-pair>Pair a screen</button>
      <dialog id="canccu-studio-pair"><form>
        <div data-insecure hidden>This address can't pair screens</div>
        <input name="code"><input name="name"><select name="zone_key"><option value="">Later</option><option value="main">Main</option></select>
        <p data-pair-error role="alert" hidden></p>
        <button type="submit">Pair</button><button type="button" data-close>Cancel</button>
      </form></dialog>`;
    win.history.replaceState(null, "", `/admin/screen/devices${hash}`);
    const page = {
      isSecureContext: secure,
      location: win.location,
      history: win.history,
      sessionStorage: win.sessionStorage,
    };
    pairing(doc, page, {
      api: (method, url, body) => {
        calls.push({ method, url, body });
        return Promise.resolve(answer);
      },
      failure: (r) => `Refused: ${r.data?.error?.message ?? ""}`,
      reloadWith: (message, next) => went.push({ message, next }),
      say,
    });
  }
  const dialog = () => doc.getElementById("canccu-studio-pair") as unknown as HTMLDialogElement;
  const field = (name: string) =>
    doc.querySelector(`[name=${name}]`) as unknown as HTMLInputElement;
  const error = () => doc.querySelector("[data-pair-error]") as unknown as HTMLElement;
  const submit = async () => {
    (doc.querySelector("form") as unknown as { requestSubmit(): void }).requestSubmit();
    await new Promise((r) => setTimeout(r, 0));
  };

  const hiddenNotices = () =>
    [...doc.querySelectorAll("[data-insecure]")].map((n) => (n as unknown as HTMLElement).hidden);

  beforeEach(() => {
    calls = [];
    went = [];
    answer = { status: 201, ok: true, data: { id: "dv_new" } };
    win.sessionStorage.clear();
  });

  it("opens from the kiosk's QR with the code filled in, and drops the code from the address", () => {
    run("#pair=k7q4-9wxp");
    expect(dialog().open).toBe(true);
    expect(field("code").value).toBe("K7Q49WXP");
    expect(win.location.hash).toBe("");
  });

  it("opens with the code a signed-out scan kept through sign-in", () => {
    win.sessionStorage.setItem("canccu-studio-pair", "K7Q49WXP");
    run();
    expect(field("code").value).toBe("K7Q49WXP");
    expect(win.sessionStorage.getItem("canccu-studio-pair")).toBeNull();
  });

  it("pairs by a typed code and opens the page on the new screen", async () => {
    run();
    (doc.querySelector("[data-open-pair]") as unknown as HTMLElement).click();
    expect(dialog().open).toBe(true);
    field("code").value = "k7q4 9wxp";
    field("name").value = " Hall left ";
    field("zone_key").value = "main";
    await submit();
    expect(calls).toEqual([
      {
        method: "POST",
        url: "/api/screen/devices",
        body: { code: "K7Q49WXP", name: "Hall left", zone_key: "main" },
      },
    ]);
    expect(went).toEqual([
      { message: "Hall left is paired.", next: "/admin/screen/devices?paired=dv_new" },
    ]);
  });

  it("says a wrong or expired code in the dialog, not behind it", async () => {
    run("#pair=K7Q49WXP");
    field("name").value = "Hall left";
    answer = refused(400, "code_invalid", "This code is unknown, used or expired.");
    await submit();
    expect(error().hidden).toBe(false);
    expect(error().textContent).toBe("That code is wrong or has expired.");
    expect(dialog().open).toBe(true);
    expect(went).toEqual([]);
    // Trying again clears the old error first.
    answer = { status: 201, ok: true, data: { id: "dv_2" } };
    await submit();
    expect(error().hidden).toBe(true);
  });

  it("says offline, a missing venue and any other refusal in the dialog too", async () => {
    run("#pair=K7Q49WXP");
    field("name").value = "Hall left";
    answer = { status: 0, ok: false, data: null };
    await submit();
    expect(error().textContent).toBe("Your phone or computer is offline.");
    answer = refused(409, "no_venue");
    await submit();
    expect(error().textContent).toBe("This event has no venue yet.");
    answer = refused(403, "missing_right", "You may not pair screens.");
    await submit();
    expect(error().textContent).toBe("Refused: You may not pair screens.");
  });

  it("shows the plain-http notice only where the page is not a secure context", () => {
    run();
    expect(hiddenNotices()).toEqual([true, true]);
    run("", false);
    expect(hiddenNotices()).toEqual([false, false]);
  });
});
