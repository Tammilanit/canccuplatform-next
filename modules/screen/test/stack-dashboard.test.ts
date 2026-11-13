import { describe, expect, it } from "vitest";
import { crowded } from "./stack/dashboard.mjs";

const at = (left: number, right: number, top = 0, bottom = 100) => ({ left, right, top, bottom });

describe("crowded", () => {
  it("passes statistics on one line with a real gap between them", () => {
    expect(crowded([[at(0, 150), at(180, 300), at(330, 420)]], 11)).toEqual([]);
  });

  it("names a number that runs into the next one, as in equal columns", () => {
    expect(crowded([[at(0, 184), at(187, 350), at(380, 500)]], 11)).toEqual([
      "box 1, items 1 and 2: 3 px apart",
    ]);
  });

  it("names labels drawn over the next numbers, box by box", () => {
    const strip = [at(0, 295), at(190, 420), at(379, 568)];
    expect(crowded([strip, [at(0, 100)], strip], 11)).toEqual([
      "box 1, items 1 and 2: -105 px apart",
      "box 1, items 2 and 3: -41 px apart",
      "box 3, items 1 and 2: -105 px apart",
      "box 3, items 2 and 3: -41 px apart",
    ]);
  });

  it("lets a statistic wrapped to a line of its own sit under another", () => {
    expect(crowded([[at(0, 300), at(320, 500), at(0, 120, 110, 210)]], 11)).toEqual([]);
  });
});
