/// <reference lib="dom" />
/**
 * The sound desk in Chromium (#626, the step 4 polish sheets 01–04): static/sound-desk.js on the
 * server's own views. The editor moves a sound between the players and the add-chips, says each
 * slider's value and what a level is heard at, steps the catch-up, lists the unsaved changes and
 * plays one sound at a time; every sub-page and the editor fit 1280 px and a 390 px phone.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { BUILTIN_CUES, DEFAULT_SOUND_SETTINGS, PACK } from "../src/cues/catalog.js";
import { cueEditor } from "../src/cues/cue-form.js";
import { deskPage } from "../src/cues/views.js";
import type { DeskZone, LibraryView, Sub } from "../src/cues/views.js";
import { launch } from "./chromium.js";

const browser = await launch();
const file = (url: URL | string) => readFileSync(url, "utf8");
const css = [
  file(createRequire(import.meta.url).resolve("@canccu/ui/ui.css")),
  file(new URL("../static/moments.css", import.meta.url)),
  file(new URL("../static/organiser.css", import.meta.url)),
  file(new URL("../static/sound-desk.css", import.meta.url)),
  file(new URL("../static/sound-desk-lists.css", import.meta.url)),
  file(new URL("../static/sound-desk-pages.css", import.meta.url)),
].join("\n");
// Both scripts, as the desk's pages load them: each must leave the other's parts alone.
const script = [
  file(new URL("../static/moments.js", import.meta.url)),
  file(new URL("../static/sound-desk.js", import.meta.url)),
].join("\n");
const ORIGIN = "http://moments.test";
const NOW = new Date("2026-11-17T21:32:00Z");

const LIBRARY: LibraryView[] = PACK.map((p) => ({
  id: p.id,
  title: p.title,
  url: `/api/moments/sounds/pack/${p.file}`,
  length_ms: p.length_ms,
  source: "pack",
  used_by: BUILTIN_CUES.filter((c) => c.sounds.includes(p.id)).map((c) => c.name),
  warning: null,
}));
const ZONES: DeskZone[] = [
  {
    zone_key: "main",
    minute: 0,
    hour: 2,
    energy: "lively",
    lets_through: ["urgent", "result", "attention", "something_new", "ended", "ambient"],
    sound_screen: { name: "Main hall screen 1", online: true, audio_unlocked: true },
  },
  {
    zone_key: "entrance",
    minute: 0,
    hour: 0,
    energy: "lively",
    lets_through: null,
    sound_screen: null,
  },
];
const CUES = BUILTIN_CUES.map((c) => ({ ...c, revision: 0 }));
const START = { ...(CUES.find((c) => c.name === "tournament.start") as (typeof CUES)[number]) };
START.sounds = ["pack.gong"];

/** A fake Audio, so a play needs no file and the test sees which one plays. */
const FAKE_AUDIO = `window.Audio = class {
  constructor(src) { this.src = src; this.paused = true; this.currentTime = 0; this.duration = 2; this.l = {}; }
  addEventListener(t, f) { (this.l[t] ??= []).push(f); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; for (const f of this.l.pause ?? []) f(); }
};`;

async function open(body: string, width: number): Promise<Page> {
  if (browser === undefined) throw new Error("the suite runs only with a browser");
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true });
  const page = await context.newPage();
  await page.addInitScript(FAKE_AUDIO);
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body class="canccu-page"><main class="canccu-main" style="padding:1rem">${body}</main><script>${script}</script></body></html>`,
    }),
  );
  await page.goto(`${ORIGIN}/`);
  return page;
}

const editor = () =>
  String(
    cueEditor({
      cue: START,
      library: LIBRARY,
      settings: DEFAULT_SOUND_SETTINGS,
      zones: ["main", "entrance"],
      canTake: true,
    }),
  );
const desk = (sub: Sub) =>
  String(
    deskPage({
      sub,
      settings: { ...DEFAULT_SOUND_SETTINGS, revision: 3 },
      zones: ZONES,
      cues: CUES,
      library: LIBRARY,
      log: [
        {
          seq: 2,
          at: NOW,
          zone_key: "entrance",
          cue: "announce.attention",
          sound: "pack.chime-bright",
          outcome: "suppressed",
          reason: "no_sound_screen",
          detail: null,
          source: null,
        },
      ],
      check: null,
      query: {},
      timeZone: "UTC",
      now: NOW,
      canTake: true,
      canWrite: true,
    }),
  );
const fits = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

(browser ? describe : describe.skip)("the sound desk in Chromium", () => {
  afterAll(async () => {
    await browser?.close();
  });

  it("adds a sound from the library as a player, and removes one back to the chips", async () => {
    const page = await open(editor(), 1280);
    const chosen = page.locator("[data-chosen]");
    await expect(chosen.locator("[data-player]").count()).resolves.toBe(1);
    await page.locator("[data-add] label", { hasText: "Drum roll" }).click();
    await expect(chosen.locator("[data-player]").count()).resolves.toBe(2);
    await expect(
      page.locator('input[name=sounds][value="pack.drum-roll"]').isChecked(),
    ).resolves.toBe(true);
    await expect(page.locator(".canccu-savebar__text").textContent()).resolves.toBe(
      "Unsaved changes: sounds",
    );
    await chosen.getByRole("checkbox", { name: "Remove Gong" }).click();
    await expect(chosen.locator("[data-player]").count()).resolves.toBe(1);
    await expect(page.locator("[data-add] label", { hasText: "Gong" }).count()).resolves.toBe(1);
    await expect(page.locator('input[name=sounds][value="pack.gong"]').isChecked()).resolves.toBe(
      false,
    );
  });

  it("says each slider's value, what the level is heard at, and the category's meaning", async () => {
    const page = await open(editor(), 1280);
    const slide = (name: string, value: string) =>
      page.locator(`input[name=${name}]`).evaluate((el, v) => {
        (el as HTMLInputElement).value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
    await slide("level", "50");
    await expect(page.locator("[data-heard]").textContent()).resolves.toBe(
      "Heard at 32 %: master 80 % × Something new 80 % × this cue 50 %.",
    );
    await slide("cooldown_step", "3");
    await expect(page.locator("output[for=cooldown_step]").textContent()).resolves.toBe("2 min");
    await slide("hold_seconds", "90");
    await expect(page.locator("output[for=hold_seconds]").textContent()).resolves.toBe("90 s");
    await page.getByRole("radio", { name: "Urgent", exact: true }).check();
    await expect(page.locator("[data-meaning-line]").textContent()).resolves.toContain(
      "Urgent plays at 100 %, interrupts whatever plays",
    );
    await expect(page.locator("[data-heard]").textContent()).resolves.toBe(
      "Heard at 40 %: master 80 % × Urgent 100 % × this cue 50 %.",
    );
    await expect(page.locator(".canccu-savebar__text").textContent()).resolves.toBe(
      "Unsaved changes: category, level, not again for, holds for",
    );
  });

  it("steps the catch-up a minute at a time, never below zero", async () => {
    const page = await open(editor(), 1280);
    const input = page.locator("input[name=catch_up_minutes]");
    await page.getByRole("button", { name: "One minute more" }).click();
    await expect(input.inputValue()).resolves.toBe("3");
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "One minute less" }).click();
    await expect(input.inputValue()).resolves.toBe("0");
  });

  it("plays one sound at a time", async () => {
    const page = await open(desk("library"), 1280);
    const players = page.locator("[data-player]");
    await players.nth(0).locator("button").click();
    await expect(players.nth(0).getAttribute("class")).resolves.toContain("is-playing");
    await players.nth(1).locator("button").click();
    await expect(players.nth(0).getAttribute("class")).resolves.not.toContain("is-playing");
    await expect(players.nth(1).getAttribute("class")).resolves.toContain("is-playing");
    await players.nth(1).locator("button").click();
    await expect(players.nth(1).getAttribute("class")).resolves.not.toContain("is-playing");
  });

  it("counts the mute down", async () => {
    const until = new Date(Date.now() + 90_000).toISOString();
    const page = await open(
      String(
        deskPage({
          sub: "cues",
          settings: { ...DEFAULT_SOUND_SETTINGS, muted_until: until, revision: 1 },
          zones: ZONES,
          cues: CUES,
          library: LIBRARY,
          log: [],
          check: null,
          query: {},
          timeZone: "UTC",
          now: new Date(),
          canTake: true,
          canWrite: true,
        }),
      ),
      1280,
    );
    await page.waitForFunction(() =>
      /\(1:2\d left\)/.test(document.querySelector("[data-until]")?.textContent ?? ""),
    );
  });

  it("uploads a chosen file to Screen once, then links it", async () => {
    const page = await open(desk("library"), 1280);
    let uploads = 0;
    await page.route(`${ORIGIN}/api/screen/assets`, (route) => {
      uploads += 1;
      return route.fulfill({ status: 201, contentType: "application/json", body: '{"id":"as_1"}' });
    });
    const linked = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().endsWith("/moments/cues/library"),
    );
    await page.locator("input[type=file]").setInputFiles({
      name: "bell.ogg",
      mimeType: "audio/ogg",
      buffer: Buffer.from("OggS"),
    });
    expect((await linked).postData()).toContain("asset_id=as_1");
    expect(uploads).toBe(1);
  });

  for (const width of [1280, 390])
    it(`fits ${String(width)} px: every sub-page and the editor, with no sideways scroll`, async () => {
      for (const body of [desk("cues"), desk("library"), desk("limits"), desk("log"), editor()]) {
        const page = await open(body, width);
        await expect(fits(page)).resolves.toBe(true);
        await page.context().close();
      }
    });
});
