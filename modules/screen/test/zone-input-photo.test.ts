/**
 * The zone input's check of the photo wall's seconds (src/zone-input.ts; contracts/screen.md,
 * Photos; #540): the API behind saving, previewing and previewing on a screen refuses what the
 * wall would draw as its default, so a zone saved never shows other seconds than it was given.
 */
import { describe, expect, it } from "vitest";
import { KitError } from "@canccu/kit";
import { zoneInput } from "../src/zone-input.js";

const zone = (widget: string, props: Record<string, unknown>) => ({
  key: "hall",
  name: "Hall",
  regions: { hero: { widgets: [{ widget, props }] } },
});
const refusal = (body: unknown) => {
  try {
    zoneInput(body);
  } catch (error) {
    return error instanceof KitError ? [error.status, error.code, error.message] : error;
  }
  return null;
};

describe("a photo entry's seconds", () => {
  for (const seconds of [4, 61, 7.5, "8"]) {
    it(`refuses ${JSON.stringify(seconds)}, with the field named`, () => {
      expect(refusal(zone("photo", { photo_seconds: seconds }))).toEqual([
        400,
        "invalid_request",
        "regions.hero.widgets[0].props.photo_seconds must be a whole number from 5 to 60.",
      ]);
    });
  }

  it("takes a whole number from 5 to 60, or none", () => {
    expect(refusal(zone("photo", { photo_seconds: 5 }))).toBeNull();
    expect(refusal(zone("photo", { photo_seconds: 60 }))).toBeNull();
    expect(refusal(zone("photo", { order: "oldest" }))).toBeNull();
  });

  it("is no rule for another widget's prop of that name", () => {
    expect(refusal(zone("clock", { photo_seconds: 3 }))).toBeNull();
  });
});
