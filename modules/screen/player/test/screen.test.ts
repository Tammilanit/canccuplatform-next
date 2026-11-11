// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FADE_MS } from "../src/display.js";
import { Screen } from "../src/screen.js";
import { applyPatch } from "../src/state.js";
import type { Region, ScreenState } from "../src/state.js";
import { screenState } from "./fake.js";

const T0 = Date.parse("2026-03-14T18:00:00Z");

const widget = (type: string, view: Record<string, unknown> = {}, dwell = 5) => ({
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

function state(regions: Region[], over: Partial<ScreenState> = {}): ScreenState {
  return screenState({
    layout: { id: "pulse", aspect: "16:9", grid: { columns: 12, rows: 12 } },
    regions,
    display: { motion: "none", drift: false },
    ...over,
  });
}

/** The server's clock ahead of the device's (fake) one. */
let shift = 0;
let reduced = false;
const host = { serverNow: () => Date.now() + shift, reducedMotion: () => reduced };
const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};
const shownIn = (screen: Screen, id: string) =>
  [...(screen.root.querySelector(`.canccu-region--${id}`)?.children ?? [])].map(
    (c) => c.textContent,
  );

describe("the screen's layout", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    shift = 0;
    reduced = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws the layout's grid with each region in its cells and at its layer", () => {
    const screen = new Screen(host);
    const root = screen.draw(
      state([region("hero", { area: { column: 1, row: 2, columns: 8, rows: 10 }, layer: 1 })]),
    );
    expect(root.className).toBe("canccu-layout canccu-layout--pulse");
    expect(root.style.getPropertyValue("--canccu-layout-ratio")).toBe(String(16 / 9));
    expect(root.style.getPropertyValue("grid-template-columns")).toBe("repeat(12, minmax(0, 1fr))");
    const hero = root.querySelector<HTMLElement>(".canccu-region.canccu-region--hero");
    expect(hero?.style.getPropertyValue("grid-area")).toBe("2 / 1 / span 10 / span 8");
    expect(hero?.style.getPropertyValue("z-index")).toBe("1");
    expect(hero?.dataset.role).toBe("hero");
  });

  it("letterboxes a portrait layout to its own shape", () => {
    const screen = new Screen(host);
    const root = screen.draw(
      state([region("rail")], {
        layout: { id: "pulse_portrait", aspect: "9:16", grid: { columns: 6, rows: 16 } },
      }),
    );
    expect(root.style.getPropertyValue("--canccu-layout-ratio")).toBe(String(9 / 16));
    expect(root.style.getPropertyValue("grid-template-rows")).toBe("repeat(16, minmax(0, 1fr))");
  });

  it("keeps its elements for the same layout, and starts over for another", () => {
    const screen = new Screen(host);
    const first = screen.draw(state([region("rail")]));
    const rail = first.querySelector(".canccu-region--rail");
    expect(screen.draw(state([region("rail")]))).toBe(first);
    expect(first.querySelector(".canccu-region--rail")).toBe(rail);
    const other = screen.draw(
      state([region("rail")], {
        layout: { id: "split", aspect: "16:9", grid: { columns: 2, rows: 1 } },
      }),
    );
    expect(other).not.toBe(first);
  });
});

describe("what a region shows", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    shift = 0;
    reduced = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const rotating = region("rail", {
    order: [0, 1],
    widgets: [widget("ticker", { text: "one" }), widget("ticker", { text: "two" })],
  });

  it("rotates on the server's clock and marks the shown widget active", async () => {
    const screen = new Screen(host);
    screen.draw(state([rotating]));
    screen.start();
    expect(shownIn(screen, "rail")).toEqual(["one"]);
    expect(
      screen.root.querySelector(".canccu-widget")?.classList.contains("canccu-is-active"),
    ).toBe(true);
    await advance(5000);
    expect(shownIn(screen, "rail")).toEqual(["two"]);
    await advance(5000);
    expect(shownIn(screen, "rail")).toEqual(["one"]);
    screen.stop();
    await advance(5000);
    expect(shownIn(screen, "rail")).toEqual(["one"]);
  });

  it("fades the next widget in over the last, which then goes, and swaps at once without motion", async () => {
    const screen = new Screen(host);
    screen.draw(state([rotating], { display: { motion: "moderate", drift: false } }));
    expect(screen.root.dataset.motion).toBe("moderate");
    screen.start();
    await advance(5000);
    expect(shownIn(screen, "rail")).toEqual(["one", "two"]);
    const [out] = screen.root.querySelectorAll(".canccu-region--rail > *");
    expect(out?.classList.contains("canccu-slot--out")).toBe(true);
    await advance(FADE_MS.moderate);
    expect(shownIn(screen, "rail")).toEqual(["two"]);
    reduced = true;
    await advance(5000);
    expect(screen.root.dataset.motion).toBe("none");
    expect(shownIn(screen, "rail")).toEqual(["one"]);
  });

  it("fades the ticker between texts", async () => {
    const screen = new Screen(host);
    screen.draw(state([region("ticker")], { display: { motion: "calm", drift: false } }));
    screen.draw(
      state([region("ticker", { widgets: [widget("ticker", { text: "Seats open 20:30." })] })], {
        display: { motion: "calm", drift: false },
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(shownIn(screen, "ticker")).toEqual(["Hello", "Seats open 20:30."]);
    await advance(FADE_MS.calm);
    expect(shownIn(screen, "ticker")).toEqual(["Seats open 20:30."]);
  });

  it("shows a widget a pushed region adds to a shuffle, and drops one it takes out", () => {
    const shuffled = (order: number[]) =>
      region("rail", {
        rotation: "shuffle",
        order,
        widgets: [widget("ticker", { text: "one" }), widget("ticker", { text: "two" })],
      });
    const screen = new Screen(host);
    const before = state([shuffled([0])]);
    screen.draw(before);
    expect(shownIn(screen, "rail")).toEqual(["one"]);
    const added = applyPatch(before, "region", { state_version: 2, region: shuffled([1]) });
    expect(added).not.toBeNull();
    screen.draw(added as ScreenState);
    expect(shownIn(screen, "rail")).toEqual(["two"]);
  });

  it("keeps a widget that waits for its images unseen when its data changes meanwhile", () => {
    const screen = new Screen(host);
    const motion = { display: { motion: "moderate", drift: false } } as const;
    const ticker = (text: string, stale: boolean) =>
      region("rail", { widgets: [widget("agenda_now", { title: text, items: [], stale })] });
    screen.draw(state([region("rail")], motion));
    screen.draw(state([ticker("Now", false)], motion));
    const incoming = screen.root.querySelector(".canccu-region--rail > :last-child");
    expect(incoming?.classList.contains("canccu-slot--in")).toBe(true);
    screen.draw(state([ticker("Later", true)], motion));
    expect(incoming?.textContent).toContain("Later");
    expect(incoming?.classList.contains("canccu-slot--in")).toBe(true);
    expect(incoming?.classList.contains("canccu-is-stale")).toBe(true);
    expect(incoming?.classList.contains("canccu-is-active")).toBe(true);
  });

  it("changes a shown widget's data in place, without a fade", () => {
    const screen = new Screen(host);
    const agenda = (name: string) =>
      region("rail", {
        widgets: [widget("agenda_now", { title: "Now", items: [{ name, state: "now" }] })],
      });
    screen.draw(state([agenda("Dinner")], { display: { motion: "moderate", drift: false } }));
    const before = screen.root.querySelector(".canccu-widget");
    screen.draw(
      state([agenda("Dinner, moved")], { display: { motion: "moderate", drift: false } }),
    );
    expect(shownIn(screen, "rail")).toHaveLength(1);
    expect(screen.root.querySelector(".canccu-widget")).toBe(before);
    expect(before?.textContent).toContain("Dinner, moved");
  });

  it("keeps the clock and the countdowns going between pushes", async () => {
    const screen = new Screen(host);
    const next = { label: "Semis start in", target_at: "2026-03-14T19:30:00Z", ends_text: null };
    screen.draw(
      state([
        region("header", { widgets: [widget("clock", { iso: "", time: "18:00", date: "" })] }),
        region("hero", {
          order: [],
          idle: "next",
          idle_view: {
            widget: "countdown",
            view: { ...next, qr: null, stale: false, empty: false },
          },
        }),
      ]),
    );
    screen.start();
    const time = () => screen.root.querySelector(".canccu-region--hero time")?.textContent;
    expect(time()).toBe("01:30:00");
    await advance(61_000);
    expect(time()).toBe("01:28:59");
    expect(screen.root.querySelector(".canccu-widget--clock")?.textContent).toContain("18:01");
  });

  it("shows the idle choice when nothing takes part: logo, blank, collapse", () => {
    const screen = new Screen(host);
    const idle = (id: string, how: string) =>
      region(id, { order: [], idle: how, widgets: [widget("photo", { empty: true })] });
    screen.draw(
      state([idle("a", "logo"), idle("b", "blank"), idle("c", "collapse"), idle("d", "unknown")], {
        theme: {
          revision: 1,
          tokens_css_url: null,
          css_url: null,
          logo_url: "/theming/a/l.svg",
          templates: [],
        },
      }),
    );
    const at = (id: string) => screen.root.querySelector<HTMLElement>(`.canccu-region--${id}`);
    expect(at("a")?.querySelector(".canccu-widget--logo img")?.getAttribute("src")).toBe(
      "/theming/a/l.svg",
    );
    expect(at("b")?.children.length).toBe(0);
    expect(at("c")?.hidden).toBe(true);
    expect(at("d")?.querySelector(".canccu-widget--logo img")?.getAttribute("alt")).toBe(
      "Demo Event",
    );
  });

  it("draws with the theme's templates and passes the ticker's appearance on", () => {
    const screen = new Screen(host);
    const templates = [
      { name: "ticker", widget: "ticker", tree: [{ text: "» " }, { field: "text" }] },
    ];
    const root = screen.draw(
      state([region("ticker")], {
        theme: { revision: 2, tokens_css_url: null, css_url: null, logo_url: null, templates },
        ticker: { text: "Hello", until: null, source: "admin", appearance: "high_contrast" },
      }),
    );
    expect(shownIn(screen, "ticker")).toEqual(["» Hello"]);
    expect(root.dataset.ticker).toBe("high_contrast");
  });
});

describe("burn-in drift", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    shift = 15 * 60_000;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shifts the whole layout by the minute of the server's hour while it is on", async () => {
    const screen = new Screen(host);
    const root = screen.draw(state([region("rail")], { display: { motion: "none", drift: true } }));
    screen.start();
    expect(Number(root.style.getPropertyValue("--canccu-drift-x"))).toBeCloseTo(0);
    expect(Number(root.style.getPropertyValue("--canccu-drift-y"))).toBeCloseTo(1);
    await advance(15 * 60_000);
    expect(Number(root.style.getPropertyValue("--canccu-drift-x"))).toBeCloseTo(-1);
    screen.draw(state([region("rail")], { display: { motion: "none", drift: false } }));
    expect(root.style.getPropertyValue("--canccu-drift-x")).toBe("");
  });
});
