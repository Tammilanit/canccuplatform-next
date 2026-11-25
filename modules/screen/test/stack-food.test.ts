// The food box's fit check on the CI screenshots (#775): its rules on what the browser measures,
// held here without a stack or a browser; the views it judges are in stack/food.mjs.
import { describe, expect, it } from "vitest";
import { FOOD_CLAIM_OF, judgeFood } from "./stack/food.mjs";
import type { FoodMeasure } from "./stack/food.mjs";

/** The venue rail's food box at 1080p and the QR's card beside it, the layout's gap between. */
const BOX = { left: 1275, top: 631, right: 1566, bottom: 948 };
const QR = { left: 1581, top: 631, right: 1872, bottom: 948 };

function measure(over: Partial<FoodMeasure> = {}): FoodMeasure {
  return {
    box: BOX,
    frame: null,
    qr: QR,
    gap: 15,
    texts: [{ text: "Demo Pizzeria", left: 1304, top: 860, right: 1540, bottom: 900 }],
    ...over,
  };
}

describe("the food box's fit check", () => {
  it("passes a box whose text and frame stay inside it", () => {
    expect(judgeFood(measure())).toEqual([]);
    expect(judgeFood(measure({ frame: { ...BOX } }))).toEqual([]);
  });

  // #779: the box and the QR touched, read as one box in another: the layout's gap between them.
  it("fails a box that touches the hub QR's card", () => {
    const problems = judgeFood(measure({ box: { ...BOX, right: 1581 } }));
    expect(problems).toEqual([
      "the food box is 0 px from the hub QR's card, under the layout's gap of 15 px",
    ]);
  });

  it("fails a screen with no food box", () => {
    expect(judgeFood(null)).toEqual(["no food box on the screen"]);
  });

  // #775: "On the way · about" and "collect at Entrance table" ran into the QR's half.
  it("fails text that runs past the box's edge, under the QR", () => {
    const texts = [
      { text: "collect at Entrance table", left: 1304, top: 820, right: 1600, bottom: 860 },
    ];
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
    const frame = { ...BOX, right: 1527 };
    expect(judgeFood(measure({ frame }))).toEqual([
      "the cue's frame is drawn apart from the box (right edge 1527 px, the box's 1566 px): two frames",
    ]);
  });

  it("allows a pixel of rounding", () => {
    const texts = [{ text: "Demo Pizzeria", left: 1274.5, top: 860, right: 1566.6, bottom: 948.4 }];
    const box = { ...BOX, right: 1566.6 };
    expect(judgeFood(measure({ texts, box, frame: { ...BOX, right: 1565.8 } }))).toEqual([]);
  });

  // The longest pickup note pizza accepts (its LIMITS.pickup, 80), at 1080p, portrait and 4K.
  it("hands the shots a long pizzeria name and the longest pickup note pizza accepts", () => {
    const here = FOOD_CLAIM_OF["claim-food-long"][1].content;
    const [row] = here.orders as { pizzeria_name: string; status_text: string; pickup: string }[];
    expect(row?.pickup).toHaveLength(80);
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
