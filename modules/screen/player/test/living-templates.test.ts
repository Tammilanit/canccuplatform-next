// @vitest-environment happy-dom
// The idle rotation's hero items as the player draws them (#787 D1, sheet 01): the coming hours
// on a moving line, and the food item with its QR and a live countdown.
import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES } from "../src/templates.js";
import { renderTree } from "../src/tree.js";
import { fillCountdowns } from "../src/widget.js";

const draw = (type: string, view: Record<string, unknown>): HTMLElement => {
  const box = document.createElement("div");
  const nodes = DEFAULT_TEMPLATES[type] ?? [];
  box.append(...renderTree(nodes, { qr: null, stale: false, empty: false, ...view }));
  return box;
};

describe("the coming hours", () => {
  const view = {
    title: "The coming hours",
    from: "2026-03-14T18:00:00.000Z",
    to: "2026-03-14T21:00:00.000Z",
    from_text: "18:00",
    to_text: "21:00",
    items: [
      { name: "Dinner", kind: "food", starts_text: "17:30", place: "Café", col: 1, cols: 3 },
      { name: "Semi-finals", kind: "tournament", starts_text: "19:30", place: "Main stage", col: 10, cols: 9 },
    ],
    marks: [{ label: "Pizza order closes", at_text: "18:30", col: 4 }],
  }; // prettier-ignore

  it("places each item on the line by its start and length, with its time and place", () => {
    const box = draw("agenda_timeline", view);
    expect(box.querySelector(".canccu-widget__kicker")?.textContent).toBe("The coming hours");
    const spans = [...box.querySelectorAll(".canccu-widget__span")];
    expect(spans.map((s) => s.querySelector(".canccu-widget__name")?.textContent)).toEqual([
      "Dinner",
      "Semi-finals",
    ]);
    expect(spans[1]?.className).toContain("canccu-widget__span--col-10");
    expect(spans[1]?.className).toContain("canccu-widget__span--cols-9");
    expect(spans[1]?.textContent).toContain("19:30");
    expect(spans[1]?.textContent).toContain("Main stage");
    const mark = box.querySelector(".canccu-widget__mark");
    expect(mark?.className).toContain("canccu-widget__mark--col-4");
    expect(mark?.textContent).toBe("Pizza order closes18:30");
  });

  it("moves its now line with the clock, across the three hours", () => {
    const box = draw("agenda_timeline", view);
    const now = box.querySelector<HTMLElement>(".canccu-widget__now");
    fillCountdowns(box, Date.parse("2026-03-14T19:30:00Z"));
    expect(now?.style.getPropertyValue("--canccu-progress")).toBe("0.5");
    expect(now?.textContent).toBe("");
  });
});

describe("the food item in the hero", () => {
  it("draws the order's QR and counts down to its close", () => {
    const box = draw("food_status", {
      title: "Food",
      big_label: "Open · closes",
      big_text: "18:30",
      orders: [{ pizzeria_name: "Demo Pizzeria", status_text: "Open · closes 18:30 · 9 pizzas" }],
      join: { url: "https://demo.example/pizza/orders/po_1", label: "Join the order", image_url: "data:image/svg+xml;base64,AA==" },
      countdown_at: "2026-03-14T18:30:00Z",
    }); // prettier-ignore
    const join = box.querySelector(".canccu-widget__join");
    expect(join?.querySelector("img")?.getAttribute("src")).toBe("data:image/svg+xml;base64,AA==");
    expect(join?.textContent).toBe("Join the order");
    fillCountdowns(box, Date.parse("2026-03-14T18:18:00Z"));
    expect(box.querySelector(".canccu-widget__countdown")?.textContent).toBe("00:12:00");
  });

  it("draws neither while no order is open to join or counting down", () => {
    const box = draw("food_status", { title: "Food", orders: [], join: null, countdown_at: null });
    expect(box.querySelector(".canccu-widget__join")).toBeNull();
    expect(box.querySelector(".canccu-widget__countdown")).toBeNull();
  });
});
