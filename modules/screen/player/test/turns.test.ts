// @vitest-environment happy-dom
// What each box shows while the choreographer holds a turn back (#546; contracts/screen.md, The
// Director): the held widget with its fresh view, its marks, the hero and the rail joined on what
// is on screen, and the rail's idle choice when the join empties it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Screen } from "../src/screen.js";
import type { Region, ScreenState, WidgetState } from "../src/state.js";
import { screenState } from "./fake.js";

const T0 = Date.parse("2026-03-14T18:00:00Z");
const SEMIS = "2026-03-14T19:30:00Z";

const widget = (type: string, view: Record<string, unknown>, dwell = 10): WidgetState => ({
  widget: type,
  template: null,
  dwell_seconds: dwell,
  view: { qr: null, stale: false, empty: false, ...view },
});
const ticker = (text: string, dwell = 10) => widget("ticker", { text }, dwell);

function region(id: string, over: Partial<Region> = {}): Region {
  return {
    id,
    role: id,
    area: { column: 1, row: 1, columns: 6, rows: 6 },
    layer: 0,
    rotation: "sequence",
    order: [0, 1],
    cycle_started_at: new Date(T0).toISOString(),
    idle: "logo",
    idle_view: null,
    widgets: [ticker("a"), ticker("b")],
    claim: null,
    ...over,
  };
}

const state = (regions: Region[]): ScreenState =>
  screenState({
    layout: { id: "pulse", aspect: "16:9", grid: { columns: 12, rows: 12 } },
    regions,
    display: { motion: "none", drift: false },
  });

/** A box that turns at 8 s, so a box turning at 10 s waits for the choreographer until 11 s. */
const early = region("venue", { role: null, widgets: [ticker("v1", 8), ticker("v2", 8)] });

const host = { serverNow: () => Date.now(), reducedMotion: () => false };
const at = (screen: Screen, ms: number) => {
  vi.setSystemTime(T0 + ms);
  screen.tick();
};
const box = (root: ParentNode, id: string) => root.querySelector(`.canccu-region--${id}`);
const line = (root: ParentNode, id: string) =>
  box(root, id)?.querySelector(".canccu-is-active .canccu-widget__line")?.textContent;

describe("a held turn", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 + 1000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks the widget drawn, its turn run out, not the one the rotation has moved on to", () => {
    const screen = new Screen(host);
    const root = screen.draw(state([region("hero"), early]));
    at(screen, 8000);
    at(screen, 10_000);
    expect(line(root, "hero")).toBe("a");
    const marks = box(root, "hero")?.querySelector<HTMLElement>(".canccu-rotation");
    const lit = () =>
      [...(marks?.querySelectorAll(".canccu-rotation__dot") ?? [])].map((d) =>
        d.classList.contains("canccu-is-active"),
      );
    expect(lit()).toEqual([true, false]);
    expect(marks?.style.getPropertyValue("--canccu-progress")).toBe("1");
    at(screen, 11_000);
    expect(line(root, "hero")).toBe("b");
    expect(lit()).toEqual([false, true]);
  });

  it("redraws the held widget with its fresh view, so a removed photo goes", () => {
    const photo = (name: string) => ({
      url: `/f/${name}.jpg`,
      caption: name,
      author_name: null,
      posted_at: new Date(T0).toISOString(),
      featured: false,
      featured_until: null,
      tiles: [{ url: `/f/${name}.jpg`, caption: name, author_name: null, posted_at: new Date(T0).toISOString() }], // prettier-ignore
    });
    const hero = (name: string) =>
      region("hero", { widgets: [widget("photo", photo(name)), ticker("b")] });
    const screen = new Screen(host);
    const root = screen.draw(state([hero("one"), early]));
    at(screen, 8000);
    at(screen, 10_000);
    // Held on the photo; the photo is removed and the wall leads with another.
    screen.draw(state([hero("two"), early]));
    const html = box(root, "hero")?.innerHTML ?? "";
    expect(html).toContain("/f/two.jpg");
    expect(html).not.toContain("/f/one.jpg");
  });
});

describe("the hero and the rail joined on what is shown", () => {
  const rows = [
    { name: "Dinner", state: "now", starts_text: "17:30", ends_text: "19:15", starts_at: "2026-03-14T17:30:00Z", location: "Café", delay_minutes: 0 },
    { name: "Semis", state: "next", starts_text: "19:30", ends_text: "21:00", starts_at: SEMIS, location: "Stage", delay_minutes: 0 },
  ]; // prettier-ignore
  const semis = { label: "Semis", target_at: SEMIS, ends_text: "21:00" };
  const names = (root: ParentNode) =>
    [...(box(root, "rail")?.querySelectorAll(".canccu-widget__name") ?? [])].map(
      (n) => n.textContent,
    );

  beforeEach(() => {
    vi.useFakeTimers({ now: T0 + 1000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the hero's item off the rail while the hero is held on it, and back once it turns", () => {
    const hero = region("hero", { widgets: [widget("countdown", semis), ticker("b")] });
    const rail = region("rail", { order: [0], widgets: [widget("agenda_now", { items: rows })] });
    const screen = new Screen(host);
    const root = screen.draw(state([hero, rail, early]));
    expect(names(root)).toEqual(["Dinner"]);
    at(screen, 8000);
    at(screen, 10_000);
    // The hero still counts down to the semis: never on both boxes.
    expect(box(root, "hero")?.querySelector(".canccu-widget--countdown")).not.toBeNull();
    expect(names(root)).toEqual(["Dinner"]);
    at(screen, 11_000);
    expect(line(root, "hero")).toBe("b");
    expect(names(root)).toEqual(["Dinner", "Semis"]);
  });

  it("leaves the hero's item on the rail while the hero is held before turning to it", () => {
    const hero = region("hero", { widgets: [ticker("a"), widget("countdown", semis)] });
    const rail = region("rail", { order: [0], widgets: [widget("agenda_now", { items: rows })] });
    const screen = new Screen(host);
    const root = screen.draw(state([hero, rail, early]));
    at(screen, 8000);
    at(screen, 10_000);
    // The hero still shows its ticker: the semis stay on the rail, never on neither box.
    expect(line(root, "hero")).toBe("a");
    expect(names(root)).toEqual(["Dinner", "Semis"]);
    at(screen, 11_000);
    expect(box(root, "hero")?.querySelector(".canccu-widget--countdown")).not.toBeNull();
    expect(names(root)).toEqual(["Dinner"]);
  });

  it("falls back to the logo when the emptied rail's idle countdown is the hero's own item", () => {
    const hero = region("hero", { order: [0], widgets: [widget("countdown", semis)] });
    const idleView = { widget: "countdown", view: { ...semis, qr: null, stale: false, empty: false } }; // prettier-ignore
    const rail = region("rail", {
      order: [0],
      widgets: [widget("agenda_now", { items: rows.slice(1) })],
      idle: "next",
      idle_view: idleView,
    });
    const root = new Screen(host).draw(state([hero, rail]));
    expect(box(root, "rail")?.querySelector(".canccu-widget--countdown")).toBeNull();
    expect(box(root, "rail")?.querySelector(".canccu-widget--logo")).not.toBeNull();
    // Another item's idle countdown still counts down.
    const other = { ...idleView, view: { ...idleView.view, label: "Final", target_at: "2026-03-14T21:15:00Z" } }; // prettier-ignore
    const again = new Screen(host).draw(state([hero, { ...rail, idle_view: other }]));
    expect(box(again, "rail")?.querySelector(".canccu-widget--countdown")).not.toBeNull();
  });
});
