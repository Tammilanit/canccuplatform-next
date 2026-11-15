// @vitest-environment happy-dom
/**
 * The Content page's uploads as the browser runs them (static/studio-content.js, #542), on the
 * page the server draws (src/studio/content-view.ts): the file inputs reached with the keyboard,
 * a long file name checked as the title it will get, a refused replace giving the card its line
 * back, files dropped while an upload runs, and a library card dragged over the upload band.
 */
import type { HTMLElement, HTMLInputElement, Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contentView } from "../src/studio/content-view.js";
import type { ContentAsset } from "../src/studio/content-view.js";
import { translator } from "../src/studio/messages.js";
import type { ViewContext } from "../src/studio/views.js";

const win = globalThis as unknown as Window;
const { document } = win;
// A plain script has no types, so the path stays a value rather than a module to look up.
const SCRIPT = "../static/studio-content.js";
const ASSET = "application/x-canccu-asset";
const c: ViewContext = {
  t: translator("en"),
  rights: new Set(["screen.content.read", "screen.content.write"]),
  nowMs: 0,
  timeZone: "UTC",
  startUrl: null,
};
const POSTER: ContentAsset = {
  id: "as_1",
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
};

/** A multipart upload the test answers: its address, and its progress and end as events. */
class FakeXhr extends EventTarget {
  static sent: FakeXhr[] = [];
  url = "";
  status = 0;
  responseText = "";
  upload = new EventTarget();
  open(_method: string, url: string) {
    this.url = url;
  }
  send() {
    FakeXhr.sent.push(this);
  }
  answer(status: number, data: unknown) {
    this.upload.dispatchEvent(new Event("load"));
    this.status = status;
    this.responseText = JSON.stringify(data);
    this.dispatchEvent(new Event("load"));
  }
}

const studio = {
  api: vi.fn<(method: string, url: string, body?: unknown) => Promise<unknown>>(() =>
    Promise.resolve({ ok: true, status: 200, data: { results: [{ asset_ids: [] }] } }),
  ),
  confirmed: () => true,
  counted: (key: string) => key,
  failure: () => "failed",
  reloadWith: vi.fn(),
  say: (key: string) => key,
  show: vi.fn(),
};

// The scripts listen on the document, which outlives each test's page: what one run of them
// added is taken off again, so the next run is the only one listening.
type Listener = Parameters<typeof document.addEventListener>;
const listening: Listener[] = [];
const listen = document.addEventListener.bind(document);
(document as unknown as { addEventListener: (...a: Listener) => void }).addEventListener = (
  ...a
) => {
  listening.push(a);
  listen(...a);
};

beforeEach(async () => {
  FakeXhr.sent = [];
  document.body.innerHTML = String(
    contentView(c, {
      assets: [POSTER],
      next: null,
      jobs: new Map(),
      query: { q: "", kind: "", after: "" },
      webOn: true,
      index: { as_1: ["image", false] },
    }),
  ).replace(/<img[^>]*>/g, "");
  Object.assign(win, {
    canccuStudio: studio,
    XMLHttpRequest: FakeXhr,
    fetch: () => Promise.resolve({ ok: false }),
  });
  vi.resetModules();
  await import(/* @vite-ignore */ SCRIPT);
});

afterEach(() => {
  const unlisten = document.removeEventListener.bind(document);
  for (const [type, listener] of listening.splice(0)) unlisten(type, listener);
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

const file = (name: string) => new win.File(["x"], name, { type: "image/png" });
/** The files a person picked with the input, as the browser hands them over. */
function choose(input: HTMLInputElement, files: unknown[]): void {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new win.Event("change", { bubbles: true }));
}
const band = () => document.querySelector("[data-upload]") as HTMLElement;
function dragOn(type: string, data: { types: string[]; files?: unknown[]; uri?: string }) {
  const event = new win.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types: data.types,
      files: data.files ?? [],
      getData: (t: string) => (t === "text/uri-list" ? (data.uri ?? "") : ""),
    },
  });
  band().dispatchEvent(event);
  return event;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the file inputs", () => {
  for (const [name, selector] of [
    ["upload", "[data-upload-input]"],
    ["replace", "input[data-replace]"],
  ] as const) {
    it(`for ${name} take the keyboard's focus, visually hidden, not hidden`, () => {
      const input = document.querySelector(selector) as HTMLInputElement;
      expect(input.hidden).toBe(false);
      expect(input.classList.contains("canccu-studio-file")).toBe(true);
      expect(input.closest("label")?.classList.contains("canccu-button")).toBe(true);
      input.focus();
      expect(document.activeElement).toBe(input);
    });
  }

  it("upload the files chosen", async () => {
    choose(document.querySelector("[data-upload-input]") as HTMLInputElement, [file("a.png")]);
    await vi.waitFor(() => {
      expect(FakeXhr.sent.map((x) => x.url)).toEqual(["/api/screen/assets"]);
    });
  });

  it("replace a card's file with the one chosen", async () => {
    choose(document.querySelector("input[data-replace]") as HTMLInputElement, [file("b.png")]);
    await vi.waitFor(() => {
      expect(FakeXhr.sent.map((x) => x.url)).toEqual(["/api/screen/assets/as_1/replace"]);
    });
  });
});

describe("the name check", () => {
  it("sends a long name as the title the upload stores: trimmed, at most 200 characters", async () => {
    const long = `  ${"n".repeat(240)}.png`;
    choose(document.querySelector("[data-upload-input]") as HTMLInputElement, [file(long)]);
    await settle();
    expect(studio.api).toHaveBeenCalledWith("POST", "/api/screen/assets/name-check", {
      names: ["n".repeat(200)],
    });
  });
});

describe("a refused replace", () => {
  it("gives the card its line back", async () => {
    const status = document.querySelector("#asset-as_1 [data-asset-status]") as HTMLElement;
    const before = status.textContent;
    choose(document.querySelector("input[data-replace]") as HTMLInputElement, [file("b.png")]);
    FakeXhr.sent[0]?.upload.dispatchEvent(new Event("load"));
    expect(status.textContent).toBe("asset.replacing");
    FakeXhr.sent[0]?.answer(400, { error: { code: "media_unsupported", message: "No." } });
    await settle();
    expect(status.textContent).toBe(before);
    expect(studio.show).toHaveBeenCalledWith("upload.refused");
  });
});

describe("files dropped while an upload runs", () => {
  it("are not taken, and the notice says to wait", async () => {
    dragOn("drop", { types: ["Files"], files: [file("a.png")] });
    await vi.waitFor(() => {
      expect(FakeXhr.sent).toHaveLength(1);
    });
    dragOn("drop", { types: ["Files"], files: [file("c.png")] });
    await settle();
    expect(studio.show).toHaveBeenCalledWith("upload.busy");
    expect(studio.api).toHaveBeenCalledTimes(1);
  });
});

describe("a library card dragged over the upload band", () => {
  it("is not taken for a link or a file", async () => {
    const card = { types: [ASSET, "text/uri-list"], uri: "http://localhost/files/poster.png" };
    expect(dragOn("dragover", card).defaultPrevented).toBe(false);
    expect(band().classList.contains("canccu-is-active")).toBe(false);
    dragOn("drop", card);
    await settle();
    const url = document.querySelector("[data-add-link] [name=url]") as HTMLInputElement;
    expect(url.value).toBe("");
    expect(studio.api).not.toHaveBeenCalled();
  });

  it("still lets a link from another tab fill the link field", () => {
    dragOn("drop", { types: ["text/uri-list"], uri: "https://example.org/page" });
    const url = document.querySelector("[data-add-link] [name=url]") as HTMLInputElement;
    expect(url.value).toBe("https://example.org/page");
  });
});
