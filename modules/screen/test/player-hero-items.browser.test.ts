/// <reference lib="dom" />
/**
 * The idle rotation's coming hours and statistics in a hero (#787 D1), in Chromium, held to the
 * CI shots' own checks: no text under the size floor or short of contrast, none cut by its box,
 * and no empty band over a quarter of the hero. CI's shots caught the floor and the band late
 * (the coming hours' text followed the box's height down to 22 px; two numbers left 27 % bare),
 * so the sizes are the screens' own (1080p, 4K, portrait) and the hero's three shapes.
 */
import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { panelFilled } from "./stack/clear.mjs";
import { collectSamples, judgePage } from "./stack/readability.mjs";
import { bundle, draw, launch, screenPage, tick } from "./player-browser.js";
import type { FoodOrder } from "../src/compose/food.js";
import { unitsWide } from "../src/compose/layouts.js";
import type { Area, Layout } from "../src/compose/layouts.js";
import { viewOf } from "../src/compose/widgets.js";
import type { AgendaItem, ZoneFacts } from "../src/compose/widgets.js";

const STATES = JSON.parse(
  await readFile(new URL("fixtures/pulse-states.json", import.meta.url), "utf8"),
) as Record<
  "landscape" | "portrait",
  {
    time: string;
    regions: Region[];
    layout: { aspect: string; grid: { columns: number; rows: number } };
  }
>;
interface Region {
  id: string;
  area: unknown;
  order: number[];
  rotation: string;
  widgets: unknown[];
}

const browser = await launch();
const code = browser === undefined ? undefined : await bundle();
afterAll(async () => {
  await browser?.close();
});

const NAMES = [
  "Dinner",
  "Demo Game Cup, semis",
  "Board games corner and a long name",
  "Quiz",
  "Karaoke",
];
/** Five items an hour apart from the state's next half hour, with an order closing in 20 minutes. */
function timeline(nowMs: number, kind: "landscape" | "portrait", area: { columns: number }) {
  const layout = STATES[kind].layout;
  const first = Math.ceil(nowMs / 1_800_000) * 1_800_000;
  const at = (ms: number) => new Date(ms).toISOString();
  const items = NAMES.map((title, i) => ({
    id: `t${String(i)}`,
    title,
    kind: "tournament",
    starts_at: at(first + i * 3_600_000),
    ends_at: at(first + (i + 1) * 3_600_000),
    delay_minutes: 0,
    location: "Main stage",
    visibility: "public",
    status: "scheduled",
    zone: null,
  })) as AgendaItem[];
  const order = { id: "po_1", state: "open", closes_at: at(nowMs + 20 * 60_000) } as FoodOrder;
  const facts = {
    now: new Date(nowMs),
    timeZone: "UTC",
    origin: "https://demo.example",
    eventName: "Demo Event",
    logoUrl: null,
    agenda: { current: [], next: [] },
    venue: null,
    ticker: { text: null, until: null, source: null },
    timeline: items,
    food: { orders: [order], names: false },
  } as ZoneFacts;
  // The server sizes the line for the box (src/compose/timeline.ts): its hours and labels' room.
  const box = { ...area, columns: Math.min(area.columns, layout.grid.columns) } as Area;
  return viewOf("agenda_timeline", {}, facts, null, unitsWide(box, layout as Layout));
}
const peaks = {
  online_peak: { count: 231, at: "2026-11-20T23:30:00Z", time_text: "01:30" },
  in_voice_peak: { count: 64, at: "2026-11-20T21:00:00Z", time_text: "23:00" },
};
/** The statistics as the bot fills them: two numbers, then with the check-ins, each with its peak. */
const STATS = {
  "two numbers": { online: 187, in_voice: 46, online_trend: "up", in_voice_trend: "flat" },
  "two numbers with peaks": { online: 187, in_voice: 46, ...peaks },
  "three numbers": { online: 187, in_voice: 46, checked_in: 164 },
  "three numbers with peaks": { online: 187, in_voice: 46, checked_in: 164, ...peaks },
  "the bot's full set": {
    members: 1240,
    online: 218,
    in_voice: 38,
    checked_in: 164,
    members_trend: "flat",
    online_trend: "up",
    in_voice_trend: "flat",
    ...peaks,
  },
  "online and check-ins": { online: 187, checked_in: 164, online_trend: "up", ...peaks },
  "in voice and check-ins": { in_voice: 46, checked_in: 164, in_voice_trend: "flat", ...peaks },
  "one number": { checked_in: 164 },
  "one number with its peak": { online: 187, online_trend: "up", ...peaks },
};

/** The Pulse's hero area, the Hero layout's full width, the Dashboard's small box. */
const AREAS = [
  { column: 1, row: 2, columns: 8, rows: 10 },
  { column: 1, row: 2, columns: 12, rows: 10 },
  { column: 1, row: 2, columns: 4, rows: 5 },
];
const SIZES: ["landscape" | "portrait", [number, number]][] = [
  ["landscape", [1920, 1080]],
  ["landscape", [3840, 2160]],
  ["portrait", [1080, 1920]],
  ["portrait", [2160, 3840]],
];

describe.skipIf(browser === undefined)(
  "a hero's coming hours and numbers",
  { timeout: 60_000 },
  () => {
    for (const [widget, label, viewFor] of [
      ["agenda_timeline", "coming hours", timeline],
      ...Object.entries(STATS).map(([name, v]) => ["stats", name, () => v] as const),
    ] as const)
      for (const [kind, size] of SIZES)
        for (const area of AREAS)
          it(`${label}, ${kind} ${size.join("×")}, ${area.columns} columns wide`, async () => {
            if (browser === undefined || code === undefined) throw new Error("no browser");
            const state = structuredClone(STATES[kind]);
            const hero = state.regions.find((r) => r.id === "hero");
            if (hero === undefined) throw new Error("the fixture has no hero");
            hero.area = area;
            hero.rotation = "director";
            hero.order = [0];
            hero.widgets = [
              {
                widget,
                template: null,
                embed: null,
                dwell_seconds: 45,
                stale_after_seconds: null,
                view: {
                  qr: null,
                  stale: false,
                  empty: false,
                  ...viewFor(Date.parse(state.time), kind, area),
                },
              },
            ];
            const page = await screenPage(browser, code, size, Date.parse(state.time), "");
            await draw(page, state);
            await page.waitForTimeout(900);
            await tick(page, 0);
            expect(judgePage(await page.evaluate(collectSamples))).toEqual([]);
            await panelFilled(page);
            await page.close();
          });
  },
);
