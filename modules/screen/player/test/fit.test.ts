// @vitest-environment happy-dom
/**
 * A long announcement fits its box (contracts/moments.md, Templates and placeholders, E17): the
 * card's type steps down until its text fits, never below half. happy-dom lays nothing out, so the
 * test sets what the browser would measure: the text needs `need` px at full size, scaled.
 */
import { describe, expect, it } from "vitest";
import { fitAnnouncements } from "../src/fit.js";

function card(box: number, need: number): HTMLElement {
  const root = document.createElement("main");
  root.innerHTML =
    '<section class="canccu-region"><div class="canccu-widget canccu-widget--announcement">' +
    '<p class="canccu-widget__title">A long title</p></div></section>';
  const el = root.querySelector<HTMLElement>(".canccu-widget--announcement") as HTMLElement;
  Object.defineProperty(el, "clientHeight", { get: () => box });
  Object.defineProperty(el, "scrollHeight", {
    get: () => need * Number(el.style.getPropertyValue("--canccu-fit") || "1"),
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
});
