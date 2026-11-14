import { describe, expect, it } from "vitest";
import { viewOf } from "../src/compose/widgets.js";
import type { ZoneFacts } from "../src/compose/widgets.js";

const NOW = new Date("2026-01-01T12:00:07Z");

function facts(over: Partial<ZoneFacts> = {}): ZoneFacts {
  return {
    now: NOW,
    timeZone: "Europe/Helsinki",
    origin: "https://demo.example",
    eventName: "Demo Event",
    logoUrl: "/theming/r/3/logo.svg",
    agenda: { current: [], next: [] },
    venue: null,
    ticker: { text: null, until: null, source: null },
    ...over,
  };
}

const ITEM = {
  kind: "image" as const,
  url: "/api/screen/files/aaa.png",
  slide_urls: [],
  started_at: "2026-01-01T12:00:00.000Z",
  offset_seconds: 0,
  duration_seconds: 10,
  muted: true,
};

describe("content widgets", () => {
  it("playlist: the tick's item and the next one", () => {
    const view = viewOf("playlist", {}, facts({ playlist: { item: ITEM, next_item: null } }));
    expect(view).toEqual({ item: ITEM, next_item: null, qr: null, stale: false, empty: false });
  });

  it("playlist: empty while nothing plays", () => {
    expect(viewOf("playlist", {}, facts({ playlist: null })).empty).toBe(true);
  });

  it("photo: the wall its entry's props ask for", () => {
    const tile = {
      url: "/api/screen/files/p.jpg",
      caption: "Hi",
      author_name: "Sam",
      posted_at: "2026-01-01T11:00:00.000Z",
    };
    const plain = { ...tile, featured: false, tiles: [tile] };
    const slow = { ...plain, caption: "Slow" };
    const photos = { "8:newest:pop": plain, "20:shuffle:still": slow };
    expect(viewOf("photo", {}, facts({ photos }))).toMatchObject({ ...plain, empty: false });
    // A prop out of range falls back to its default, so it shares the default wall.
    expect(viewOf("photo", { photo_seconds: 99 }, facts({ photos }))).toMatchObject(plain);
    const props = { photo_seconds: 20, order: "shuffle", pop_new: false };
    expect(viewOf("photo", props, facts({ photos }))).toMatchObject(slow);
    expect(viewOf("photo", {}, facts({ photos: { "8:newest:pop": null } })).empty).toBe(true);
  });

  it("stats: the counts and check-ins as read", () => {
    expect(viewOf("stats", {}, facts({ stats: { checked_in: 164 } }))).toMatchObject({
      checked_in: 164,
      empty: false,
    });
    expect(viewOf("stats", {}, facts({ stats: null })).empty).toBe(true);
  });

  it("checkin_qr: notify's rotating code as a whole URL on the event's origin, with its QR", () => {
    const checkin = {
      purpose: "arrival",
      code: "abcdefghijklmnopqrstuv",
      url: "/notify/check-in?p=arrival&c=abcdefghijklmnopqrstuv",
      valid_until: "2026-01-01T12:01:00Z",
      rotates_at: "2026-01-01T12:00:30Z",
    };
    const view = viewOf("checkin_qr", {}, facts({ checkin }));
    expect(view).toMatchObject({
      url: "https://demo.example/notify/check-in?p=arrival&c=abcdefghijklmnopqrstuv",
      label: "Check in",
      purpose: "arrival",
      rotates_at: "2026-01-01T12:00:30Z",
      valid_until: "2026-01-01T12:01:00Z",
      stale: false,
      empty: false,
    });
    expect(view.image_url).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("checkin_qr: keeps an absolute URL as notify built it", () => {
    const checkin = {
      purpose: "arrival",
      code: "x",
      url: "https://checkin.example/notify/check-in?p=arrival&c=x",
      valid_until: "2026-01-01T12:01:00Z",
      rotates_at: "2026-01-01T12:00:30Z",
    };
    expect(viewOf("checkin_qr", {}, facts({ checkin })).url).toBe(checkin.url);
  });

  it("checkin_qr: a code notify could not give is empty and stale, never an old code", () => {
    expect(viewOf("checkin_qr", {}, facts({ checkin: null }))).toMatchObject({
      empty: true,
      stale: true,
    });
  });

  it("embed: the theme's frame for the entry's embed, over the logo", () => {
    const embeds = [{ name: "fireworks", frame_url: "/theming/sandbox/3/fireworks/index.html" }];
    expect(viewOf("embed", {}, facts({ embeds }), "fireworks")).toMatchObject({
      frame_url: "/theming/sandbox/3/fireworks/index.html",
      logo_url: "/theming/r/3/logo.svg",
      empty: false,
    });
    expect(viewOf("embed", {}, facts({ embeds }), "other").empty).toBe(true);
    expect(viewOf("embed", {}, facts({ embeds }), null).empty).toBe(true);
  });
});
