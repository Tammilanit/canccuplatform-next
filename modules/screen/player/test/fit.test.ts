// @vitest-environment happy-dom
/**
 * A long announcement fits its box (contracts/moments.md, Templates and placeholders, E17): the
 * card's type steps down until its text fits, never below half. happy-dom lays nothing out, so the
 * test sets what the browser would measure: the text needs `need` px at full size, scaled.
 */
import { describe, expect, it } from "vitest";
import { fitAnnouncements } from "../src/fit.js";

/** What the browser would measure, changeable mid-test: a new width or font reflows the text. */
interface Measure {
  box: number;
  need: number;
  width: number;
}

function card(box: number, need: number): HTMLElement {
  return measured({ box, need, width: 400 });
}

function measured(m: Measure): HTMLElement {
  const root = document.createElement("main");
  root.innerHTML =
    '<section class="canccu-region"><div class="canccu-widget canccu-widget--announcement">' +
    '<p class="canccu-widget__title">A long title</p></div></section>';
  const el = root.querySelector<HTMLElement>(".canccu-widget--announcement") as HTMLElement;
  Object.defineProperty(el, "clientHeight", { get: () => m.box });
  Object.defineProperty(el, "clientWidth", { get: () => m.width });
  Object.defineProperty(el, "scrollHeight", {
    get: () => m.need * Number(el.style.getPropertyValue("--canccu-fit") || "1"),
  });
  return root;
}

const fitOf = (root: HTMLElement) =>
  root
    .querySelector<HTMLElement>(".canccu-widget--announcement")
    ?.style.getPropertyValue("--canccu-fit");

describe("fitting an announcement to its box", () => {
  it("keeps the full size when the text fits", () => {
    const root = card(200, 180);
    fitAnnouncements(root);
    expect(fitOf(root)).toBe("1");
  });

  it("steps the type down until the text fits", () => {
    const root = card(200, 300);
    fitAnnouncements(root);
    expect(fitOf(root)).toBe("0.6");
  });

  it("never below half, and leaves a box not laid out yet alone", () => {
    const root = card(100, 1000);
    fitAnnouncements(root);
    expect(fitOf(root)).toBe("0.5");
    const hidden = card(0, 300);
    fitAnnouncements(hidden);
    expect(fitOf(hidden)).toBe("");
  });

  it("fits again when the box changes width at the same height", () => {
    const m = { box: 200, need: 300, width: 400 };
    const root = measured(m);
    fitAnnouncements(root);
    expect(fitOf(root)).toBe("0.6");
    // Wider, the same text takes fewer lines.
    m.width = 800;
    m.need = 180;
    fitAnnouncements(root);
    expect(fitOf(root)).toBe("1");
  });

  it("fits again when a web font finishes loading after the first measure", () => {
    const fonts = new EventTarget();
    Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
    try {
      const m = { box: 200, need: 300, width: 400 };
      const root = measured(m);
      fitAnnouncements(root);
      expect(fitOf(root)).toBe("0.6");
      // The fallback font was measured; the theme's narrower font now needs less room.
      m.need = 180;
      fonts.dispatchEvent(new Event("loadingdone"));
      fitAnnouncements(root);
      expect(fitOf(root)).toBe("1");
    } finally {
      Reflect.deleteProperty(document, "fonts");
    }
  });
});

describe("fitting a storyboard step in the hero (#625)", () => {
  /** A claimed step of `type` whose words need `wide` px across at full size in a 500 px box. */
  function step(type: string, wide: number, claim = true): HTMLElement {
    const root = document.createElement("main");
    root.innerHTML = `<section class="canccu-region"><div class="canccu-widget canccu-widget--${type}${claim ? " canccu-is-claim" : ""}"><p class="canccu-widget__big">Starting</p></div></section>`;
    const el = root.querySelector<HTMLElement>(".canccu-widget") as HTMLElement;
    const fit = () => Number(el.style.getPropertyValue("--canccu-fit") || "1");
    Object.defineProperty(el, "clientHeight", { get: () => 400 });
    Object.defineProperty(el, "scrollHeight", { get: () => 300 * fit() });
    Object.defineProperty(el, "clientWidth", { get: () => 500 });
    Object.defineProperty(el, "scrollWidth", { get: () => Math.max(500, wide * fit()) });
    return root;
  }
  const fitIn = (root: HTMLElement) =>
    root.querySelector<HTMLElement>(".canccu-widget")?.style.getPropertyValue("--canccu-fit");

  it("steps a sting, a card, a countdown, a QR or a crew photo down while a word runs out across", () => {
    for (const type of ["sting", "title_card", "countdown", "qr", "photo"]) {
      const root = step(type, 800);
      fitAnnouncements(root);
      expect(fitIn(root), type).toBe("0.6");
    }
  });

  it("leaves the rotation's own widgets alone: only a claim's step is fitted", () => {
    const root = step("countdown", 800, false);
    fitAnnouncements(root);
    expect(fitIn(root)).toBe("");
  });
});

// #775: the food box's status ran off its slot with a long pickup note.
describe("fitting the food box to its slot", () => {
  /** The food box in a region of `role`, whose text needs `need` px down at full size in 300. */
  function box(role: string, need: number): HTMLElement {
    const root = document.createElement("main");
    root.innerHTML = `<section class="canccu-region" data-role="${role}"><div class="canccu-widget canccu-widget--food_status"><p class="canccu-widget__row">Pizza is here</p></div></section>`;
    const el = root.querySelector<HTMLElement>(".canccu-widget") as HTMLElement;
    const fit = () => Number(el.style.getPropertyValue("--canccu-fit") || "1");
    Object.defineProperty(el, "clientHeight", { get: () => 300 });
    Object.defineProperty(el, "scrollHeight", { get: () => need * fit() });
    Object.defineProperty(el, "clientWidth", { get: () => 300 });
    Object.defineProperty(el, "scrollWidth", { get: () => 300 });
    return root;
  }
  const fitIn = (root: HTMLElement) =>
    root.querySelector<HTMLElement>(".canccu-widget")?.style.getPropertyValue("--canccu-fit");

  it("steps the box down while its text runs off the foot, claimed or not", () => {
    const root = box("venue_rail", 400);
    fitAnnouncements(root);
    expect(fitIn(root)).toBe("0.72");
  });

  it("leaves the ticker's one line alone: it runs along the edge, as the ticker's own", () => {
    const root = box("ticker", 400);
    fitAnnouncements(root);
    expect(fitIn(root)).toBe("");
  });
});
