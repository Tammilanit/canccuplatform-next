/**
 * Announcement texts (contracts/moments.md, Templates and placeholders; D11, E17): the run-of-show
 * placeholders, the organiser's free variables, validation that never lets a placeholder show raw,
 * and the limits.
 */
import { describe, expect, it } from "vitest";
import { checkText, cut, fill, freeVariables, startsIn } from "../src/announce/text.js";

const NOW = new Date("2026-03-14T19:30:00Z");
const ctx = {
  item: {
    title: "Demo Game Cup, semis",
    starts_at: "2026-03-14T19:45:00Z",
    location: "Stage",
  },
  eventName: "Demo Event",
  timeZone: "Europe/Helsinki",
  now: NOW,
};

describe("filling", () => {
  it("fills the run-of-show placeholders, the event's name and free variables", () => {
    expect(fill("{item.title} starts in {item.starts_in}", ctx, {})).toBe(
      "Demo Game Cup, semis starts in 15 minutes",
    );
    // The event's time zone: 19:45 UTC is 21:45 in Helsinki in March.
    expect(fill("{item.location} at {item.starts_at}, {event.name}", ctx, {})).toBe(
      "Stage at 21:45, Demo Event",
    );
    expect(fill("Pick up at {place}", ctx, { place: "the café" })).toBe("Pick up at the café");
  });

  it("an item without a location fills it with nothing, never the raw placeholder", () => {
    expect(fill("[{item.location}]", { ...ctx, item: { ...ctx.item, location: null } }, {})).toBe(
      "[]",
    );
  });

  it("says how long until the item starts, from when it is sent", () => {
    expect(startsIn("2026-03-14T19:31:00Z", NOW)).toBe("1 minute");
    expect(startsIn("2026-03-14T20:35:00Z", NOW)).toBe("1 h 5 min");
    expect(startsIn("2026-03-14T21:30:00Z", NOW)).toBe("2 h");
    expect(startsIn("2026-03-14T19:30:20Z", NOW)).toBe("now");
    expect(startsIn("2026-03-14T19:00:00Z", NOW)).toBe("now");
  });
});

describe("validation", () => {
  const ok = (text: string, vars: Record<string, string> = {}, item = true) =>
    checkText(text, vars, item);

  it("accepts the fixed placeholders and filled free variables", () => {
    expect(ok("{item.title} in {item.starts_in} · {event.name}")).toBeNull();
    expect(ok("At {place}", { place: "the café" })).toBeNull();
    expect(ok("No placeholders at all")).toBeNull();
  });

  it("refuses an unknown placeholder, naming it", () => {
    expect(ok("{item.colour}")).toMatch(/\{item\.colour\}/);
    expect(ok("{event.venue}")).toMatch(/\{event\.venue\}/);
    expect(ok("{Place}")).toMatch(/\{Place\}/);
  });

  it("refuses a free variable without a value", () => {
    expect(ok("At {place}")).toMatch(/\{place\}/);
    expect(ok("At {place}", { place: "  " })).toMatch(/\{place\}/);
  });

  it("refuses an item placeholder when no item is chosen", () => {
    expect(ok("{item.title}", {}, false)).toMatch(/run-of-show item/);
  });

  it("refuses a brace that opens or closes no placeholder", () => {
    expect(ok("Half {open")).toMatch(/brace/);
    expect(ok("close} here")).toMatch(/brace/);
    expect(ok("{{item.title}}")).not.toBeNull();
  });
});

describe("free variables", () => {
  it("lists the names the texts use, in order of first use, once each", () => {
    expect(freeVariables("{thing} at {place}", "{place}, {item.title}, {event.name}")).toEqual([
      "thing",
      "place",
    ]);
  });
});

describe("limits", () => {
  it("cuts a text over its limit with an ellipsis, within the limit", () => {
    expect(cut("short", 60)).toBe("short");
    const long = "x".repeat(70);
    expect(cut(long, 60)).toHaveLength(60);
    expect(cut(long, 60).endsWith("…")).toBe(true);
  });
});
