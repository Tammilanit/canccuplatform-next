// @vitest-environment happy-dom
// Each stage layer through each change (recurring finding #837: three merged PRs mishandled a
// layer's handoff: a scrim that jumped, a stale poster under the same video, particles that cut
// out or restarted, game art read from the theme-filtered hype). One table: for each layer and
// change, whether the layer shows, the value it reads, that its element is not restarted, and the
// fade its CSS gives it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lookAt } from "../src/stage-look.js";
import { StageLayer } from "../src/stage.js";
import type { BackdropView, StageLife, StageView } from "../src/stage.js";
import type { Level } from "../src/motion.js";

const T0 = Date.parse("2026-03-14T21:10:30Z");
const LOOKS = ["particles", "glows"];
const ART = `/api/screen/art/${"a".repeat(64)}.webp`;
const GAME = `/api/screen/art/${"b".repeat(64)}.webp`;
const PICTURE = `/theming/a/${"c".repeat(64)}.png`;
const PICTURE_2 = `/theming/a/${"d".repeat(64)}.png`;
const VIDEO = `/theming/a/${"e".repeat(64)}.mp4`;

/** A moment while the particles hold, and one while they fade out to the next look. */
function cycleTimes(): { held: number; fading: number } {
  let t = T0;
  while (lookAt("main", LOOKS, t, "lively").look !== "particles") t += 10_000;
  const held = t;
  while (lookAt("main", LOOKS, t, "lively").from !== "particles") t += 10_000;
  return { held, fading: t };
}
const { held, fading } = cycleTimes();

interface Scene {
  stage: StageView;
  level: Level;
  now: number;
  backdrop: BackdropView;
  life: StageLife;
}

const BASE: Scene = {
  stage: { phase: "peak", tint: { until: new Date(held + 3_600_000).toISOString() } },
  level: "lively",
  now: held,
  backdrop: { looks: LOOKS, game_art: true, daylight: true, hype: true },
  life: { zone: "main", timeZone: "UTC", hype: { level: 0.5, phase: "building" } },
};

const LAYERS = {
  picture: {
    base: { backdrop: { ...BASE.backdrop, image_url: PICTURE, scrim: 0.6 } },
    // Another theme's own picture: the same layer shows it, nothing is mounted again.
    theme: { backdrop: { looks: ["waves"], image_url: PICTURE_2, scrim: 0.7 } },
  },
  video: {
    base: { backdrop: { ...BASE.backdrop, image_url: PICTURE, video_url: VIDEO, scrim: 0.6 } },
    // A new picture under the same video: the video plays on, its poster is the new picture.
    theme: { backdrop: { looks: ["waves"], image_url: PICTURE_2, video_url: VIDEO, scrim: 0.6 } },
  },
  art: {
    base: { stage: { ...BASE.stage, tint: { ...BASE.stage.tint, art: { url: ART, scrim: 0.8 } } } },
    theme: { backdrop: { looks: ["waves"], daylight: false } },
  },
  particles: {
    base: {},
    theme: { backdrop: { looks: LOOKS, daylight: false } },
  },
  game: {
    base: { stage: { ...BASE.stage, game: { url: GAME, scrim: 0.75 } } },
    // A theme that keeps the hype still still shows the game's art: it follows the zone's hype.
    theme: { backdrop: { looks: LOOKS, hype: false, game_art: true } },
  },
} satisfies Record<string, { base: Partial<Scene>; theme: Partial<Scene> }>;
type Layer = keyof typeof LAYERS;

const CHANGES = {
  look: (s: Scene): Partial<Scene> => ({ now: s.now - held + fading }),
  hype: (): Partial<Scene> => ({
    life: { zone: "main", timeZone: "UTC", hype: { level: 0.75, phase: "building" } },
  }),
  theme: (_s: Scene, layer: Layer): Partial<Scene> => LAYERS[layer].theme,
  none: (): Partial<Scene> => ({ level: "none" }),
};
type Change = keyof typeof CHANGES;

interface Seen {
  shown: boolean;
  reads: string | number | null;
  node: Element | null;
}

const stageEl = (): HTMLElement => document.querySelector(".canccu-stage") as HTMLElement;
const part = (name: string): HTMLElement =>
  stageEl().querySelector(`.canccu-stage__${name}`) as HTMLElement;
const has = (c: string): boolean => stageEl().classList.contains(`canccu-stage--${c}`);

const SEE: Record<Layer, () => Seen> = {
  picture: () => ({
    shown: has("backdrop"),
    reads: part("backdrop").style.backgroundImage,
    node: part("backdrop"),
  }),
  video: () => {
    const v = part("backdrop").querySelector("video");
    return {
      shown: v !== null,
      reads:
        v === null ? null : `${String(v.getAttribute("src"))} ${String(v.getAttribute("poster"))}`,
      node: v,
    };
  },
  art: () => ({ shown: has("art"), reads: part("art").style.backgroundImage, node: part("art") }),
  particles: () => {
    const dots = part("particles").children;
    return { shown: dots.length > 0, reads: dots.length, node: dots[0] ?? null };
  },
  game: () => ({
    shown: has("game"),
    reads: part("game").style.backgroundImage,
    node: part("game"),
  }),
};

const url = (u: string): string => `url("${u}")`;
/** What each layer shows and reads after each change; `kept`: the same element, not restarted. */
const EXPECT: Record<Layer, Record<Change, { shown: boolean; reads: string | number | null; kept: boolean }>> = {
  picture: {
    look: { shown: true, reads: url(PICTURE), kept: true },
    hype: { shown: true, reads: url(PICTURE), kept: true },
    theme: { shown: true, reads: url(PICTURE_2), kept: true },
    none: { shown: true, reads: url(PICTURE), kept: true },
  },
  video: {
    look: { shown: true, reads: `${VIDEO} ${PICTURE}`, kept: true },
    hype: { shown: true, reads: `${VIDEO} ${PICTURE}`, kept: true },
    theme: { shown: true, reads: `${VIDEO} ${PICTURE_2}`, kept: true },
    // The picture under it is the same frame: taking the video out shows its poster.
    none: { shown: false, reads: null, kept: false },
  },
  art: {
    look: { shown: true, reads: url(ART), kept: true },
    hype: { shown: true, reads: url(ART), kept: true },
    theme: { shown: true, reads: url(ART), kept: true },
    // Tints show at lively and party only; the art stays drawn while it fades out.
    none: { shown: false, reads: url(ART), kept: true },
  },
  particles: {
    // Through the 40 s fade to the next look the dots stay as they were.
    look: { shown: true, reads: 16, kept: true },
    hype: { shown: true, reads: 20, kept: true },
    theme: { shown: true, reads: 16, kept: true },
    none: { shown: false, reads: 0, kept: false },
  },
  game: {
    look: { shown: true, reads: url(GAME), kept: true },
    hype: { shown: true, reads: url(GAME), kept: true },
    theme: { shown: true, reads: url(GAME), kept: true },
    none: { shown: true, reads: url(GAME), kept: true },
  },
}; // prettier-ignore

function apply(layer: StageLayer, s: Scene): void {
  layer.apply(s.stage, s.level, s.now, s.backdrop, s.life);
}

const cases = (Object.keys(EXPECT) as Layer[]).flatMap((layer) =>
  (Object.keys(CHANGES) as Change[]).map((change) => [layer, change] as const),
);

describe("each stage layer through each change", () => {
  it.each(cases)("%s on a %s change", (layer, change) => {
    document.body.innerHTML = "";
    const stage = new StageLayer(document.body);
    const base: Scene = { ...BASE, ...LAYERS[layer].base };
    apply(stage, base);
    const before = SEE[layer]();
    expect(before.shown, "shown before the change").toBe(true);
    apply(stage, { ...base, ...CHANGES[change](base, layer) });
    const after = SEE[layer]();
    const want = EXPECT[layer][change];
    expect(after.shown, "shown").toBe(want.shown);
    expect(after.reads, "reads").toBe(want.reads);
    expect(after.node === before.node && after.node !== null, "kept").toBe(want.kept);
  });
});

const css = ["stage.css", "stage-looks.css", "stage-backdrop.css"]
  // A path, not a URL: under happy-dom `URL` is the page's, which node:fs does not take.
  .map((f) => readFileSync(join(import.meta.dirname, "../src", f), "utf8"))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** The opacity fade, in seconds, of the rule whose selector list holds `selector`; 0 for none. */
function fadeOf(selector: string): number {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? "").split(",").map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    const t = /transition:\s*opacity\s+(?:var\([^,]+,\s*)?([\d.]+)s/.exec(m[2] ?? "");
    if (t !== null) return Number(t[1]);
  }
  return 0;
}

describe("each layer's fade", () => {
  it.each([
    // The picture (and its video, in the same layer) fades with the scrim over it, so the bare
    // picture never shows for the scrim's 2 s.
    ["picture", ".canccu-stage__backdrop", 2],
    ["art tint", ".canccu-stage__art", 2],
    ["particles", ".canccu-stage__look > *", 40],
    ["game art", ".canccu-stage__game", 3],
    ["scrim", ".canccu-stage__scrim", 2],
  ])("%s fades over its length", (_layer, selector, seconds) => {
    expect(fadeOf(selector)).toBe(seconds);
  });
});
