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

const STATES = JSON.parse(
  await readFile(new URL("fixtures/pulse-states.json", import.meta.url), "utf8"),
) as Record<"landscape" | "portrait", { time: string; regions: Region[] }>;
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
const timeline = {
  title: "The coming hours",
  from: "2026-11-25T11:00:00Z",
  to: "2026-11-25T14:00:00Z",
  now: "2026-11-25T11:40:00Z",
  from_text: "11:00",
  to_text: "14:00",
  items: NAMES.map((name, i) => ({
    name,
    kind: "tournament",
    starts_text: `1${i}:30`,
    place: "Main stage",
    col: 1 + i * 3,
    cols: 3,
    row: i + 1,
  })),
  marks: [{ label: "Pizza order closes", at_text: "11:30", col: 4 }],
};
const twoNumbers = {
  members: 412,
  online: 187,
  in_voice: 46,
  members_trend: "up",
  online_trend: "up",
  in_voice_trend: "flat",
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
    for (const [widget, view] of [
      ["agenda_timeline", timeline],
      ["stats", twoNumbers],
    ] as const)
      for (const [kind, size] of SIZES)
        for (const area of AREAS)
          it(`${widget}, ${kind} ${size.join("×")}, ${area.columns} columns wide`, async () => {
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
                view: { qr: null, stale: false, empty: false, ...view },
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
