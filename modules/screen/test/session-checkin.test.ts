/**
 * A person's view of a zone never carries the live check-in code (contracts/screen.md, A zone
 * for a session): not in a state, a region or a widget message, and not through a resume over a
 * layout change, where a `widget` message's index could name another widget than now.
 */
import { describe, expect, it } from "vitest";
import type { RegionView } from "../src/compose/build.js";
import { SessionStream, sampleRegions } from "../src/push/session.js";
import type { SessionDeps } from "../src/push/session.js";
import type { Entry, Message } from "../src/push/store.js";
import { context } from "./helpers.js";

const CODE = {
  url: "https://alpha.test/c/SECRET",
  image_url: "data:image/svg+xml,SECRET",
  label: "Check in",
  purpose: "arrival",
  rotates_at: "2026-01-01T12:01:00Z",
  valid_until: "2026-01-01T12:02:00Z",
  qr: { image_url: "data:SECRET" },
  stale: false,
  empty: false,
};

const region = (id: string, types: string[]): RegionView =>
  ({
    id,
    widgets: types.map((widget) => ({
      widget,
      view: widget === "checkin_qr" ? { ...CODE } : { text: "hi", qr: null },
    })),
  }) as unknown as RegionView;

/** Opens the filter and the resume rule, which are the stream's own. */
class Probe extends SessionStream {
  pass(message: Message): Message | null {
    return this.filter(message);
  }
  resumes(missed: Entry[]): boolean {
    return this.canResume(missed);
  }
}

const probe = () =>
  new Probe({} as SessionDeps, {
    ctx: context("alpha"),
    host: "alpha.test",
    zone: "main",
    orientation: "landscape",
    cookie: "",
    ip: "",
  });

describe("the check-in code in a person's view", () => {
  it("is left out of a state's regions, keeping the label and purpose", () => {
    const [r] = sampleRegions([region("rail", ["clock", "checkin_qr"])]);
    const view = r?.widgets[1]?.view as Record<string, unknown>;
    expect(JSON.stringify(r)).not.toContain("SECRET");
    expect(view).toMatchObject({ label: "Check in", purpose: "arrival", url: null, qr: null });
  });

  it("is left out of region and widget messages, by the types it last sent", () => {
    const p = probe();
    p.pass({ event: "state", data: { regions: [region("rail", ["clock", "checkin_qr"])] } });
    const widget = (index: number) =>
      p.pass({
        event: "widget",
        data: { state_version: 2, region_id: "rail", index, view: { ...CODE } },
      });
    expect(JSON.stringify(widget(1))).not.toContain("SECRET");
    expect(widget(0)?.data.view).toMatchObject({ url: CODE.url });

    const moved = p.pass({
      event: "region",
      data: { state_version: 3, region: region("rail", ["checkin_qr", "clock"]) },
    });
    expect(JSON.stringify(moved)).not.toContain("SECRET");
    expect(JSON.stringify(widget(0))).not.toContain("SECRET");
    // A region it never saw is left out rather than guessed.
    expect(
      p.pass({ event: "widget", data: { region_id: "hero", index: 0, view: { ...CODE } } }),
    ).toBeNull();
  });

  it("never passes a command, nor an event it does not know (fails closed)", () => {
    expect(probe().pass({ event: "command", data: { command: "reload" } })).toBeNull();
    // An event added later, before the filter learns to sample it.
    const unknown = { event: "views", data: { view: { ...CODE } } } as unknown as Message;
    expect(probe().pass(unknown)).toBeNull();
    const ticker: Message = { event: "ticker", data: { items: [] } };
    expect(probe().pass(ticker)).toBe(ticker);
  });

  it("resumes only over changes that keep every region's widgets", () => {
    const p = probe();
    const entry = (messages: Message[] | null): Entry => ({
      version: 2,
      epoch: "e",
      messages: { landscape: messages, portrait: null },
    });
    const ticker: Message = { event: "ticker", data: {} };
    expect(p.resumes([entry([ticker])])).toBe(true);
    expect(p.resumes([entry([ticker]), entry(null)])).toBe(false);
    expect(p.resumes([entry([{ event: "region", data: {} }])])).toBe(false);
  });
});
