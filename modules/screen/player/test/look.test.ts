// @vitest-environment happy-dom
// The built-in Pulse look (#375, mockups 02–04 and sheet 9 of docs/design): what the default
// templates and the screen draw beyond the view-models, so a theme can restyle every part.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Screen } from "../src/screen.js";
import type { Region, ScreenState } from "../src/state.js";
import { DEFAULT_TEMPLATES } from "../src/templates.js";
import { renderTree } from "../src/tree.js";
import { fillCountdowns } from "../src/widget.js";
import { screenState } from "./fake.js";

const T0 = Date.parse("2026-03-14T18:00:00Z");

const draw = (type: string, view: Record<string, unknown>): HTMLElement => {
  const box = document.createElement("div");
  const nodes = DEFAULT_TEMPLATES[type] ?? [];
  box.append(...renderTree(nodes, { qr: null, stale: false, empty: false, ...view }));
  return box;
};
const textOf = (box: ParentNode, cls: string): string | undefined =>
  box.querySelector(`.canccu-widget__${cls}`)?.textContent ?? undefined;

describe("the built-in templates", () => {
  it("draws the logo beside the event's name and the zone's", () => {
    const box = draw("logo", { url: "/l.svg", name: "Demo Event", zone_name: "Main hall" });
    expect(box.querySelector("img")?.getAttribute("src")).toBe("/l.svg");
    // The name is written beside the image, so the image itself says nothing more.
    expect(box.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(textOf(box, "name")).toBe("Demo Event");
    expect(textOf(box, "zone")).toBe("Main hall");
  });

  it("puts the date before the clock's time", () => {
    expect(draw("clock", { time: "18:42", date: "Sat 14 Mar" }).textContent).toBe(
      "Sat 14 Mar18:42",
    );
  });

  it("labels the ticker's line", () => {
    const box = draw("ticker", { text: "Pizza orders close at 20:00" });
    expect(textOf(box, "label")).toBe("Info");
    expect(textOf(box, "line")).toBe("Pizza orders close at 20:00");
  });

  it("gives a now row its end and a next row its start", () => {
    const items = [
      { name: "Dinner", state: "delayed", starts_text: "18:00", ends_text: "19:15", location: "Café", delay_minutes: 15 },
      { name: "Semis", state: "next", starts_text: "19:30", ends_text: null, location: "Stage", delay_minutes: 0 },
    ]; // prettier-ignore
    const rows = draw("agenda_now", { title: "Now and next", items }).querySelectorAll("li");
    expect(textOf(rows[0] as Element, "until")).toBe("until 19:15");
    expect(textOf(rows[0] as Element, "delay")).toBe("+15 min");
    expect(textOf(rows[1] as Element, "starts")).toBe("19:30");
    expect(textOf(rows[1] as Element, "where")).toBe("Stage");
  });

  it("heads a countdown with a kicker and fills a bar towards its target", () => {
    const box = draw("countdown", {
      label: "Grand final",
      target_at: "2026-03-14T18:30:00Z",
      ends_text: "21:45",
    });
    expect(textOf(box, "kicker")).toBe("Next up");
    expect(textOf(box, "headline")).toBe("Grand final");
    const bar = box.querySelector<HTMLElement>(".canccu-widget__bar");
    expect(bar?.getAttribute("datetime")).toBe("2026-03-14T18:30:00Z");
    fillCountdowns(box, T0);
    // Half an hour of the hour the bar spans is left.
    expect(bar?.style.getPropertyValue("--canccu-progress")).toBe("0.5");
    expect(box.querySelector(".canccu-widget__big")?.textContent).toBe("00:30:00");
    expect(bar?.textContent).toBe("");
  });

  it("shows how long a check-in code lasts", () => {
    const box = draw("checkin_qr", {
      url: "https://a.test/notify/check-in?p=arrival&c=x",
      label: "Check in",
      image_url: "data:image/svg+xml;base64,QQ",
      rotates_at: new Date(T0 + 12_000).toISOString(),
    });
    fillCountdowns(box, T0);
    const bar = box.querySelector<HTMLElement>(".canccu-widget__bar");
    expect(bar?.style.getPropertyValue("--canccu-progress")).toBe("0.6");
  });

  it("names what a claim brings: an announcement, a hot game", () => {
    expect(
      textOf(draw("announcement", { title: "Dinner", body: "", level: "info" }), "kicker"),
    ).toBe("Announcement");
    const hot = draw("hot_game", { game: { name: "Demo Game", cover_url: null }, players: 14 });
    expect(textOf(hot, "kicker")).toBe("Hot right now");
  });
});

const widget = (type: string, view: Record<string, unknown> = {}, dwell = 10) => ({
  widget: type,
  template: null,
  dwell_seconds: dwell,
  view: { qr: null, stale: false, empty: false, ...view },
});

function region(id: string, over: Partial<Region> = {}): Region {
  return {
    id,
    role: id,
    area: { column: 1, row: 1, columns: 12, rows: 1 },
    layer: 0,
    rotation: "sequence",
    order: [0],
    cycle_started_at: new Date(T0).toISOString(),
    idle: "logo",
    idle_view: null,
    widgets: [widget("ticker", { text: "Hello" })],
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

describe("the screen's own parts of the look", () => {
  const host = { serverNow: () => Date.now(), reducedMotion: () => false };
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the zone beside the event in the header's logo", () => {
    const screen = new Screen(host);
    const header = region("header", {
      widgets: [widget("logo", { url: null, name: "Demo Event" })],
    });
    const root = screen.draw(state([header]));
    expect(root.querySelector(".canccu-widget__zone")?.textContent).toBe("Main hall");
  });

  it("shows where a rotating hero is: a bar through the widget's time and a dot per widget", () => {
    const screen = new Screen(host);
    const hero = region("hero", {
      order: [0, 1, 2],
      widgets: [widget("ticker", { text: "a" }), widget("ticker", { text: "b" }), widget("ticker", { text: "c" })],
    }); // prettier-ignore
    vi.setSystemTime(T0 + 14_000);
    const root = screen.draw(state([hero]));
    const rotation = root.querySelector<HTMLElement>(".canccu-region--hero .canccu-rotation");
    const dots = rotation?.querySelectorAll(".canccu-rotation__dot") ?? [];
    expect(dots).toHaveLength(3);
    expect([...dots].map((d) => d.classList.contains("canccu-is-active"))).toEqual([
      false,
      true,
      false,
    ]);
    expect(rotation?.style.getPropertyValue("--canccu-progress")).toBe("0.4");
  });

  it("draws no rotation marks for a region that shows one thing", () => {
    const screen = new Screen(host);
    const root = screen.draw(state([region("hero")]));
    expect(root.querySelector(".canccu-rotation")).toBeNull();
  });

  it("marks a widget a claim brings, so the look can frame it", () => {
    const screen = new Screen(host);
    const claim = {
      override_id: "ov_1",
      hidden: false,
      role: "rail",
      rank: 80,
      template: "announcement",
      content: { title: "Dinner is served", body: "Café", level: "info" },
      steps: null,
      sound: null,
      on_end: "resume",
      starts_at: new Date(T0 - 1000).toISOString(),
      ends_at: null,
      expires_at: null,
    };
    const root = screen.draw(state([region("rail", { claim })]));
    expect(root.querySelector(".canccu-region--rail .canccu-widget")?.classList).toContain(
      "canccu-is-claim",
    );
  });
});
