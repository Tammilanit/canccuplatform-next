// The bodies of the playlist, schedule and push routes. Ported from the legacy signage
// `api-schemas.ts` and the rules half of `playlist-builder.test.ts` (item lengths and slide
// ranges; the asset-kind rules need the assets of #217) and the settings of
// `admin-api-advt.test.ts`, as one whole-document `Playlist` instead of legacy's form posts.
import { describe, expect, test } from "vitest";
import { KitError } from "@canccu/kit";
import { playlistInput, pushInput, scheduleInput } from "../src/content/input.js";

function refused(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof KitError) return `${err.code}: ${err.message}`;
    throw err;
  }
  throw new Error("accepted");
}

const item = { asset_id: "as_1", duration_seconds: 10 };

describe("playlistInput", () => {
  test("fills the defaults of a regular playlist", () => {
    expect(playlistInput({ name: " Main ", type: "regular", items: [item] })).toEqual({
      name: "Main",
      type: "regular",
      priority: 0,
      slideshow_image_seconds: null,
      break: null,
      items: [
        {
          id: null,
          asset_id: "as_1",
          duration_seconds: 10,
          slide_start: null,
          slide_end: null,
          slide_seconds: null,
        },
      ],
    });
  });

  test("refuses unknown fields, bad names and too many items", () => {
    expect(
      refused(() => playlistInput({ name: "x", type: "regular", items: [], color: 1 })),
    ).toMatch(/^invalid_request: .*`color`/);
    expect(refused(() => playlistInput({ name: "", type: "regular", items: [] }))).toMatch(/name/);
    expect(refused(() => playlistInput({ name: "x", type: "advt", items: [] }))).toMatch(/type/);
    const many = Array.from({ length: 501 }, () => item);
    expect(refused(() => playlistInput({ name: "x", type: "regular", items: many }))).toMatch(
      /500/,
    );
  });

  test("an item's length is at least 1 second, or null for the video's own", () => {
    const bad = { asset_id: "as_1", duration_seconds: 0 };
    expect(refused(() => playlistInput({ name: "x", type: "regular", items: [bad] }))).toMatch(
      /items\[0\]\.duration_seconds/,
    );
    const auto = playlistInput({
      name: "x",
      type: "regular",
      items: [{ asset_id: "as_1", duration_seconds: null }],
    });
    expect(auto.items[0]?.duration_seconds).toBeNull();
  });

  test("a slide range runs forward from slide 1", () => {
    const range = (slide_start: unknown, slide_end: unknown) => () =>
      playlistInput({
        name: "x",
        type: "regular",
        items: [{ asset_id: "as_1", slide_start, slide_end, slide_seconds: 5 }],
      });
    expect(refused(range(0, 3))).toMatch(/slide_start/);
    expect(refused(range(4, 2))).toMatch(/cannot be after/);
    expect(range(2, 4)().items[0]).toMatchObject({
      slide_start: 2,
      slide_end: 4,
      slide_seconds: 5,
    });
  });

  test("a break playlist carries its settings, and only a break playlist", () => {
    const settings = { period_seconds: 120, break_seconds: 30, play_once: true };
    expect(
      playlistInput({ name: "Ads", type: "break", items: [item], break: settings }).break,
    ).toEqual({
      zones: [],
      period_seconds: 120,
      break_seconds: 30,
      window_start_minute: null,
      window_end_minute: null,
      play_once: true,
      region: "playlist",
      mode: "timeline",
      slideshow_dwell_seconds: null,
      shuffle: false,
    });
    expect(refused(() => playlistInput({ name: "Ads", type: "break", items: [] }))).toMatch(
      /`break` is required/,
    );
    expect(
      refused(() => playlistInput({ name: "x", type: "regular", items: [], break: settings })),
    ).toMatch(/only on a break playlist/);
  });

  test("break settings keep their bounds and a daily window needs both ends", () => {
    const withBreak = (b: Record<string, unknown>) => () =>
      playlistInput({
        name: "Ads",
        type: "break",
        items: [],
        break: { period_seconds: 120, break_seconds: 30, ...b },
      });
    expect(refused(withBreak({ period_seconds: 59 }))).toMatch(/period_seconds/);
    expect(refused(withBreak({ break_seconds: 4 }))).toMatch(/break_seconds/);
    expect(refused(withBreak({ window_start_minute: 600 }))).toMatch(/start and end, or neither/);
    expect(refused(withBreak({ region: "hero" }))).toMatch(/region/);
    expect(refused(withBreak({ zones: ["main", "main"] }))).toMatch(/zones/);
    expect(
      withBreak({ window_start_minute: 1320, window_end_minute: 120, transition: "crossfade" })()
        .break,
    ).toMatchObject({ window_start_minute: 1320, window_end_minute: 120, transition: "crossfade" });
  });
});

describe("bounds that keep values inside the database's columns", () => {
  test("refuses slide numbers and seconds past their bounds with 400, not a database error", () => {
    const withItem = (extra: Record<string, unknown>) => () =>
      playlistInput({ name: "x", type: "regular", items: [{ asset_id: "as_1", ...extra }] });
    expect(refused(withItem({ slide_end: 3_000_000_000 }))).toMatch(
      /^invalid_request: .*slide_end/,
    );
    expect(refused(withItem({ slide_start: 10_001 }))).toMatch(/slide_start/);
    expect(refused(withItem({ slide_seconds: 86_401 }))).toMatch(/slide_seconds/);
    expect(
      refused(() =>
        playlistInput({
          name: "x",
          type: "slideshow",
          items: [],
          slideshow_image_seconds: 2 ** 31,
        }),
      ),
    ).toMatch(/slideshow_image_seconds/);
    expect(withItem({ slide_end: 10_000, slide_seconds: 86_400 })().items[0]?.slide_end).toBe(
      10_000,
    );
  });
});

describe("scheduleInput", () => {
  const weekly = {
    zone_key: "main",
    playlist_id: "pl_1",
    priority: 10,
    days: [6, 7],
    start_minute: 600,
    end_minute: 1320,
  };

  test("reads a weekly window, with or without a null agenda_item_id", () => {
    const expected = { ...weekly, layout_id: null, agenda_item_id: null };
    expect(scheduleInput(weekly)).toEqual(expected);
    expect(scheduleInput({ ...weekly, agenda_item_id: null })).toEqual(expected);
  });

  test("reads a window bound to a run-of-show item", () => {
    expect(
      scheduleInput({
        zone_key: "main",
        playlist_id: "pl_2",
        priority: 50,
        agenda_item_id: "it_8",
      }),
    ).toEqual({
      zone_key: "main",
      playlist_id: "pl_2",
      priority: 50,
      layout_id: null,
      days: null,
      start_minute: null,
      end_minute: null,
      agenda_item_id: "it_8",
    });
  });

  test("is weekly or bound, never both or neither", () => {
    expect(refused(() => scheduleInput({ ...weekly, agenda_item_id: "it_8" }))).toMatch(
      /either .* or/,
    );
    expect(
      refused(() => scheduleInput({ zone_key: "main", playlist_id: "pl_1", priority: 1 })),
    ).toMatch(/either .* or/);
  });

  test("refuses the times the legacy refused", () => {
    expect(refused(() => scheduleInput({ ...weekly, start_minute: 1440 }))).toMatch(/Start time/);
    expect(refused(() => scheduleInput({ ...weekly, end_minute: 600 }))).toMatch(
      /cannot be the same/,
    );
    expect(refused(() => scheduleInput({ ...weekly, days: [] }))).toMatch(/Days/);
    expect(refused(() => scheduleInput({ ...weekly, priority: 1000 }))).toMatch(/priority/);
    expect(refused(() => scheduleInput({ ...weekly, zone_key: "Main Hall" }))).toMatch(/zone_key/);
  });

  test("an overnight window and one to midnight are fine", () => {
    expect(scheduleInput({ ...weekly, start_minute: 1320, end_minute: 120 }).end_minute).toBe(120);
    expect(scheduleInput({ ...weekly, end_minute: 1440 }).end_minute).toBe(1440);
  });
});

describe("pushInput", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");

  test("reads a playlist push to every zone", () => {
    expect(
      pushInput({ zones: [], playlist_id: "pl_1", until: "2026-01-01T13:00:00Z" }, now),
    ).toEqual({
      zones: [],
      playlist_id: "pl_1",
      asset_id: null,
      until: new Date("2026-01-01T13:00:00Z"),
    });
  });

  test("an explicit null target counts as left out", () => {
    const until = "2026-01-01T13:00:00Z";
    expect(pushInput({ zones: [], asset_id: "as_1", playlist_id: null, until }, now)).toMatchObject(
      {
        asset_id: "as_1",
        playlist_id: null,
      },
    );
    const bound = { zone_key: "main", playlist_id: "pl_2", priority: 50, agenda_item_id: "it_8" };
    expect(scheduleInput({ ...bound, days: null, start_minute: null }).agenda_item_id).toBe("it_8");
  });

  test("names exactly one of a playlist and an asset", () => {
    const until = "2026-01-01T13:00:00Z";
    expect(refused(() => pushInput({ zones: [], until }, now))).toMatch(/exactly one/);
    expect(
      refused(() => pushInput({ zones: [], until, playlist_id: "pl_1", asset_id: "as_1" }, now)),
    ).toMatch(/exactly one/);
  });

  test("ends in the future and at most 12 hours ahead", () => {
    const at = (until: string) => () =>
      pushInput({ zones: ["main"], asset_id: "as_1", until }, now);
    expect(refused(at("2026-01-01T11:59:00Z"))).toMatch(/12 hours/);
    expect(refused(at("2026-01-02T00:00:01Z"))).toMatch(/12 hours/);
    expect(refused(at("tomorrow"))).toMatch(/until/);
    expect(at("2026-01-02T00:00:00Z")().until.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });
});
