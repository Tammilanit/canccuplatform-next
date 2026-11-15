// @vitest-environment happy-dom
/**
 * The ends the ticker and a freeze send (static/studio-ends.js, #539, #545): read on the event's
 * clock, never the browser's, and the ticker's "At a time" refused without a time.
 */
import type { HTMLFormElement, HTMLInputElement, Window } from "happy-dom";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { wallInstant } from "../static/studio-playlist-builder.js";

const win = globalThis as unknown as Window;
const ZONE = "Europe/Helsinki";
// Sun 15 Nov 2026: 12:00 in Helsinki (UTC+2), 05:00 in New York, where the browser is.
const NOW = Date.parse("2026-11-15T10:00:00Z");

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown>;
}
let calls: Call[];
let shown: string[];
const browserZone = process.env.TZ;

beforeAll(async () => {
  process.env.TZ = "America/New_York";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  win.document.body.innerHTML = `
    <form data-ticker data-time-zone="${ZONE}">
      <textarea name="text">Doors close soon</textarea>
      <input type="radio" name="for" value="60" checked>
      <input type="radio" name="for" value="at">
      <input type="radio" name="for" value="none">
      <input type="time" name="at">
      <button type="submit">Show</button>
    </form>
    <form data-freeze data-time-zone="${ZONE}">
      <input type="datetime-local" name="until">
      <button type="submit">Freeze</button>
    </form>`;
  Object.assign(win, {
    canccuStudio: {
      api: (method: string, url: string, body: Record<string, unknown>) => {
        calls.push({ method, url, body });
        return Promise.resolve({ ok: true, status: 200, data: {} });
      },
      failure: () => "failed",
      reloadWith: (message: string) => shown.push(`reload: ${message}`),
      say: (key: string) => key,
      show: (message: string) => shown.push(message),
    },
  });
  // @ts-expect-error: a page script, without types
  await import("../static/studio-ends.js");
});
afterAll(() => {
  vi.useRealTimers();
  process.env.TZ = browserZone;
});
beforeEach(() => {
  calls = [];
  shown = [];
});

const form = (name: string) => win.document.querySelector(`form[${name}]`) as HTMLFormElement;
const field = (f: HTMLFormElement, name: string) =>
  f.querySelector(`[name="${name}"]${name === "for" ? ":checked" : ""}`) as HTMLInputElement;
function submit(f: HTMLFormElement): Promise<void> {
  f.requestSubmit();
  return vi.waitFor(() => {
    expect(calls.length + shown.length).toBeGreaterThan(0);
  });
}
function chooseAt(time: string): void {
  (form("data-ticker").querySelector('[value="at"]') as HTMLInputElement).checked = true;
  field(form("data-ticker"), "at").value = time;
}

describe("the ticker's At a time", () => {
  it("ends at that time on the event's clock, not the browser's", async () => {
    chooseAt("18:30");
    await submit(form("data-ticker"));
    expect(calls).toEqual([
      {
        method: "PUT",
        url: "/api/screen/ticker",
        body: { text: "Doors close soon", until: "2026-11-15T16:30:00.000Z" },
      },
    ]);
  });

  it("ends tomorrow when the time has passed today on the event's clock", async () => {
    chooseAt("11:00");
    await submit(form("data-ticker"));
    expect(calls[0]?.body.until).toBe("2026-11-16T09:00:00.000Z");
  });

  it("is refused without a time, and sends nothing", async () => {
    chooseAt("");
    await submit(form("data-ticker"));
    expect(calls).toEqual([]);
    expect(shown).toEqual(["ticker.time_needed"]);
  });
});

describe("the freeze's end", () => {
  it("is read on the event's clock", async () => {
    field(form("data-freeze"), "until").value = "2026-11-20T18:00";
    await submit(form("data-freeze"));
    expect(calls).toEqual([
      {
        method: "PUT",
        url: "/api/screen/pin",
        body: { freeze: true, until: "2026-11-20T16:00:00.000Z" },
      },
    ]);
  });
});

describe("a wall clock in the event's zone", () => {
  it("is the instant that zone shows it, in summer time too", () => {
    expect(new Date(wallInstant(ZONE, "2026-11-20T18:00")).toISOString()).toBe(
      "2026-11-20T16:00:00.000Z",
    );
    expect(new Date(wallInstant(ZONE, "2026-07-01T09:15")).toISOString()).toBe(
      "2026-07-01T06:15:00.000Z",
    );
  });
});
