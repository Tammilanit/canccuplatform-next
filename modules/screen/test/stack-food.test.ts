// The food box's fit check on the CI screenshots (#775): its rules on what the browser measures,
// held here without a stack or a browser; the views it judges are in stack/food.mjs.
import { describe, expect, it } from "vitest";
import { FOOD_CLAIM_OF, judgeFood } from "./stack/food.mjs";
import type { FoodMeasure } from "./stack/food.mjs";

/** The venue rail's food box at 1080p: 330 px wide with the seam, the QR's card beside it. */
const BOX = { left: 1275, top: 631, right: 1605, bottom: 948 };
const QR = { left: 1605, top: 631, right: 1872, bottom: 948 };

function measure(over: Partial<FoodMeasure> = {}): FoodMeasure {
  return {
    box: BOX,
    frame: null,
    qr: QR,
    texts: [{ text: "Demo Pizzeria", left: 1304, top: 860, right: 1568, bottom: 900 }],
    ...over,
  };
}

describe("the food box's fit check", () => {
  it("passes a box whose text and frame stay inside it", () => {
    expect(judgeFood(measure())).toEqual([]);
    expect(judgeFood(measure({ frame: { ...BOX } }))).toEqual([]);
  });

  it("fails a screen with no food box", () => {
    expect(judgeFood(null)).toEqual(["no food box on the screen"]);
  });

  // #775: "On the way · about" and "collect at Entrance table" ran into the QR's half.
  it("fails text that runs past the box's edge, under the QR", () => {
    const texts = [{ text: "collect at Entrance table", left: 1304, top: 820, right: 1620, bottom: 860 }];
    const problems = judgeFood(measure({ texts }));
    expect(problems).toContain('"collect at Entrance table" runs past the box\'s right edge');
    expect(problems).toContain('"collect at Entrance table" runs under the QR');
  });

  it("fails text that runs off the box's foot or above its top", () => {
    const texts = [
      { text: "table by the stage", left: 1304, top: 930, right: 1500, bottom: 970 },
      { text: "Food", left: 1304, top: 600, right: 1400, bottom: 640 },
    ];
    expect(judgeFood(measure({ texts }))).toEqual([
      '"table by the stage" runs off the box\'s foot',
      '"Food" runs off the box\'s top',
    ]);
  });

  // #775: the cue's frame was drawn on the region, 39 px inside the claimed box's own frame.
  it("fails a cue frame drawn apart from the box: two frames", () => {
    const frame = { ...BOX, right: 1566 };
    expect(judgeFood(measure({ frame }))).toEqual([
      "the cue's frame is drawn apart from the box (right edge 1566 px, the box's 1605 px): two frames",
    ]);
  });

  it("allows a pixel of rounding", () => {
    const texts = [{ text: "Demo Pizzeria", left: 1274.5, top: 860, right: 1605.6, bottom: 948.4 }];
    expect(judgeFood(measure({ texts, frame: { ...BOX, right: 1604.2 } }))).toEqual([]);
  });

  it("hands the shots a long pizzeria name and a 40-character pickup note", () => {
    const here = FOOD_CLAIM_OF["claim-food-long"][1].content;
    const [row] = here.orders as { pizzeria_name: string; status_text: string; pickup: string }[];
    expect(row?.pickup).toHaveLength(40);
    expect(row?.status_text).toBe(`Pizza is here · collect at ${row?.pickup ?? ""}`);
    expect(row?.pizzeria_name.length).toBeGreaterThanOrEqual(36);
    const way = FOOD_CLAIM_OF["claim-food-on-the-way-long"][1].content;
    expect(way).toMatchObject({ big_label: "On the way · about", big_text: "23:18" });
    for (const [role, placed] of Object.values(FOOD_CLAIM_OF)) {
      expect(role).toBe("venue_rail");
      // As Moments' `pizza` rule sends it, with the cue whose frame the check measures.
      expect(placed).toMatchObject({ template: "pizza_placed", effect: { name: "pop" } });
    }
  });
});
