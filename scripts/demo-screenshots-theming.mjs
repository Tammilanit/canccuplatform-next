// The Theme studio's brand kit shots of scripts/demo-screenshots.mjs (group `theming`; mockup 12,
// design sheet 6), taken after the screens, so its screen preview is screen's player of the main
// zone with the fixture's run of show: first with no draft, then with one in the draft's look, and
// Preview shows it at full size. The shot waits for the Pulse's run of show, never a player that
// has drawn only the event's name. A phone page is shot with the window as tall as the page, so
// the bottom bar sits at its foot, as a phone shows it, not over the middle.
import { readFileSync } from "node:fs";
import { SESSION, expect } from "../modules/screen/test/stack/client.mjs";
import { DESK, PHONE } from "./demo-screenshots-shot.mjs";
import { presetShots } from "./demo-screenshots-presets.mjs";

const SCREEN_PREVIEW = "iframe[data-screen-preview]";
// The synthetic black mark on transparent (docs/plans/issue-784.md D20).
const BLACK_LOGO = new URL("../events/demo/images/logo-black.svg", import.meta.url);
const HD = { width: 1920, height: 1080 };
const drawn = async (page) => {
  await page.waitForFunction(
    (sel) =>
      document
        .querySelector(sel)
        ?.getAttribute("src")
        ?.startsWith("/screen/zones/"),
    SCREEN_PREVIEW,
    { timeout: 10000 },
  );
  // The rail turns between the run of show and a countdown (modules/screen/test/stack/screens.mjs).
  await page
    .frameLocator(SCREEN_PREVIEW)
    .locator(
      ".canccu-region--rail > .canccu-widget--agenda_now.canccu-is-active",
    )
    .waitFor({ timeout: 40000 });
  await page.waitForTimeout(1500);
};
/** Every box of the screen preview, where the 1920 × 1080 player draws it. */
const boxes = (page) =>
  page
    .frameLocator(SCREEN_PREVIEW)
    .locator(".canccu-region")
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        const id = [...el.classList].find((c) => c.startsWith("canccu-region--"));
        return `${id} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}`;
      }),
    );
/**
 * The PO's check (2026-11-25): the preview is the real screen scaled down whole, so no box moves
 * over several turns of the rotation, a saved change or a reload of the page. Fails the shot.
 */
const boxesStill = async (page) => {
  await drawn(page);
  const first = (await boxes(page)).sort();
  if (first.length === 0) throw new Error("the screen preview draws no box");
  const same = async (when) => {
    const now = (await boxes(page)).sort();
    if (JSON.stringify(now) !== JSON.stringify(first)) {
      throw new Error(`a box of the screen preview moved ${when}: ${first} → ${now}`);
    }
  };
  for (const turn of [1, 2, 3]) {
    await page.waitForTimeout(10000);
    await same(`by turn ${turn} of the rotation`);
  }
  const version = Number(await page.getAttribute(".canccu-studio", "data-draft-version"));
  await page.click('input[name="roundness"][value="round"]', { force: true });
  await page.waitForFunction(
    (v) => {
      const root = document.querySelector(".canccu-studio");
      return Number(root?.dataset.draftVersion) > v && root?.dataset.saveState === "saved";
    },
    version,
    { timeout: 15000 },
  );
  await page.waitForTimeout(1500);
  await same("after a saved change");
  await page.reload();
  await drawn(page);
  await same("after a reload");
};
export const STUDIO = [
  ["studio", DESK, { ready: drawn }],
  ["studio-phone", PHONE, { ready: drawn, tall: true }],
];
// The depths (plan issue-784 D1, D2; pack sheets 1 and 2), on Default · Night with the black logo.
const YOURS = "/theming/studio/yours";
const ADVANCED = "/theming/studio/advanced";
/** The editor marks a refused line and a small text as they are typed (D15), nothing saved. */
const cssError = async (page) => {
  await drawn(page);
  const editor = page.locator("textarea.canccu-studio-editor__text");
  await editor.fill(
    ".t-flare {\n  color: var(--canccu-color-accent);\n  background: url(https://example.org/flare.png);\n}\n.t-small {\n  font-size: 18px;\n}\n",
  );
  await page.waitForSelector(".canccu-studio-editor__line--error", { timeout: 5000 });
  await page.locator("#canccu-studio-editor").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
};
/** Save as my preset's dialog, open with a name typed (plan issue-784 D18). */
const saveDialog = async (page) => {
  await drawn(page);
  await page.locator('[data-mine-ask="canccu-studio-mine-save"]:visible').first().click();
  await page.locator("#canccu-studio-mine-save[open]").waitFor();
  await page.fill('#canccu-studio-mine-save input[name="name"]', "Autumn look");
  await page.waitForTimeout(300);
};
/** Behind the boxes with the organiser's picture and a video over it (D19). */
const videoForm = async (page) => {
  await drawn(page);
  await page.locator('form[data-action="backdrop-video"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
};
export const DRAFT = [
  ["theming-studio-pick-1280", DESK, { ready: drawn }],
  ["theming-studio-pick-1920", HD, { ready: drawn }],
  ["theming-studio-pick-390", PHONE, { ready: drawn, tall: true }],
  ["theming-studio-yours-1280", DESK, { path: YOURS, ready: boxesStill }],
  ["theming-studio-yours-1920", HD, { path: YOURS, ready: drawn }],
  ["theming-studio-yours-390", PHONE, { path: YOURS, ready: drawn, tall: true }],
  // Advanced (plan issue-784 D14–D16; pack sheet 4): every control beside the same preview.
  ["theming-studio-advanced-1280", DESK, { path: ADVANCED, ready: drawn }],
  ["theming-studio-advanced-1920", HD, { path: ADVANCED, ready: drawn }],
  ["theming-studio-advanced-390", PHONE, { path: ADVANCED, ready: drawn, tall: true }],
  [
    "theming-studio-advanced-css-error-1280",
    DESK,
    { path: ADVANCED, fullPage: false, ready: cssError },
  ],
  // My presets and video backgrounds (plan issue-784 D18, D19): Your looks heads the gallery above.
  ["theming-studio-mine-save-1280", DESK, { path: YOURS, fullPage: false, ready: saveDialog }],
  ["theming-studio-advanced-video-1280", DESK, { path: ADVANCED, fullPage: false, ready: videoForm }],
  [
    "studio-draft-preview",
    // Preview is a phone-width control (sheet 6); at desktop width it is hidden and the click times out.
    PHONE,
    {
      path: YOURS,
      fullPage: false,
      ready: async (page) => {
        await drawn(page);
        await page.click('[data-action="preview"]');
        await page.waitForTimeout(500);
      },
    },
  ],
];
// Publishing a light look asks first (sheet 6).
export const LIGHT = [
  ["studio-draft-light", DESK],
  ["studio-draft-light-phone", PHONE],
];

/** The black logo in each preset (AC 2 of #784): with no plate, then on the light plate. */
const PRESETS = ["default", "terminal", "level-up"];
const FIRST_SCHEME = { default: "night", terminal: "cyan", "level-up": "sunset" };
const SURFACES = [
  ["screen", HD],
  ["hub", PHONE],
  ["admin", DESK],
];
export const PLATES = PRESETS.flatMap((preset) =>
  ["none", "plate"].flatMap((plate) =>
    SURFACES.map(([surface, viewport]) => [
      `theming-${preset}-logo-black-${plate}-${surface}`,
      viewport,
      { preset, plate, path: `/theming/studio/preview/${surface}?canccu_theme=draft` },
    ]),
  ),
);

/** The dry run's lines of the brand kit. */
export function themingListed(at) {
  const lines = [];
  for (const [name, { width, height }] of STUDIO) {
    lines.push(
      `  ${name}.png  ${at("/theming/studio/")}  (${width}×${height})`,
    );
  }
  for (const [name, { width, height }, o] of DRAFT) {
    const path = o.path ?? "/theming/studio/";
    lines.push(`  ${name}.png  ${at(path)}  (${width}×${height}, with a draft)`);
  }
  for (const [name, { width, height }] of LIGHT) {
    lines.push(
      `  ${name}.png  ${at(YOURS)}  (${width}×${height}, a light draft, Publish asked)`,
    );
  }
  for (const [name, { width, height }, o] of PLATES) {
    lines.push(`  ${name}.png  ${at(o.path)}  (${width}×${height}, ${o.preset}, the black logo)`);
  }
  return lines;
}

/** The brand kit with no draft. */
export async function brandKitShots({ shot }) {
  for (const [name, viewport, o] of STUDIO) {
    await shot(name, "/theming/studio/", viewport, SESSION, o);
  }
}

/**
 * A draft from Default · Night with the black logo, which the depths draw before anything is
 * published (the plate check suggests a plate), then mockup 12's brand light, then the black
 * logo in each preset; the draft is discarded after. Throws on a failed call.
 */
export async function draftShots({ demo, shot }) {
  const draft = await demo.call("PUT", "/api/theming/draft/preset", {
    body: { preset: "default", scheme: "night" },
  });
  let version = expect(draft, 200, "a draft from Default · Night").body.draft_version;
  const logo = await demo.call(
    "PUT",
    `/api/theming/draft/file?path=images/logo.svg&draft_version=${version}`,
    { body: readFileSync(BLACK_LOGO), type: "image/svg+xml" },
  );
  version = expect(logo, 200, "the black logo").body.draft_version;
  const brand = {
    primary: "#ff7a45",
    accent: "#7c5cff",
    scheme: "dark",
    logo: "images/logo.svg",
  };
  let mine;
  try {
    version = await ownBackdrop(demo, version);
    const saved = await demo.call("POST", "/api/theming/presets", { body: { name: "Spring look" } });
    mine = expect(saved, 201, "saving Spring look").body.id;
    for (const [name, viewport, o] of DRAFT) {
      await shot(name, o.path ?? "/theming/studio/", viewport, SESSION, o);
    }
    // The box check saved a change of its own meanwhile.
    const now = await demo.call("GET", "/api/theming/draft");
    version = expect(now, 200, "the draft").body.draft_version;
    // Mockup 12's brand, light: Publish asks first (#444, sheet 6, Q11 b: warn only).
    const light = await demo.call("PUT", "/api/theming/draft/brand", {
      body: { draft_version: version, ...brand, scheme: "light" },
    });
    version = expect(light, 200, "a light brand").body.draft.draft_version;
    for (const [name, viewport] of LIGHT) {
      await shot(name, YOURS, viewport, SESSION, {
        fullPage: false,
        ready: async (page) => {
          await drawn(page);
          await page
            .locator('[data-action="light-ask"]:visible')
            .first()
            .click();
          await page.locator("#canccu-studio-light[open]").waitFor();
          await page.waitForTimeout(300);
        },
      });
    }
    version = await plateShots({ demo, shot }, version);
    version = await presetShots({ demo, shot }, version);
  } finally {
    if (mine !== undefined) {
      const dropped = await demo.call("DELETE", `/api/theming/presets/${mine}`);
      expect(dropped, 204, "deleting Spring look");
    }
    // Left behind, the draft would greet the next run's "studio" shot instead of the start.
    const gone = await demo.call(
      "DELETE",
      `/api/theming/draft?draft_version=${version}`,
    );
    expect(gone, 204, "discarding the draft");
  }
}

/** A picture, an MP4 of one `ftyp` box (Advanced only names it; nothing plays it), both behind the boxes. */
const PICTURE = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 16 9"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2a4a"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs><rect width="16" height="9" fill="url(#g)"/></svg>',
);
const VIDEO = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from("ftypisom"),
  Buffer.from([0, 0, 2, 0]),
  Buffer.from("isomavc1"),
  Buffer.from([0, 0, 0, 8]),
  Buffer.from("mdat"),
]);
async function ownBackdrop(demo, from) {
  let version = from;
  for (const [path, body, type] of [
    ["images/backdrop.svg", PICTURE, "image/svg+xml"],
    ["videos/backdrop.mp4", VIDEO, "video/mp4"],
  ]) {
    const put = await demo.call(
      "PUT",
      `/api/theming/draft/file?path=${path}&draft_version=${version}`,
      { body, type },
    );
    version = expect(put, 200, path).body.draft_version;
  }
  const parts = await demo.call("PATCH", "/api/theming/draft/parts", {
    body: {
      draft_version: version,
      backdrop_image: "images/backdrop.svg",
      backdrop_video: "videos/backdrop.mp4",
    },
  });
  return expect(parts, 200, "the picture and video behind the boxes").body.draft_version;
}

/** Each preset with the event's black logo, first with no plate, then on the plate the check names. */
async function plateShots({ demo, shot }, from) {
  let version = from;
  for (const preset of PRESETS) {
    const applied = await demo.call("PUT", "/api/theming/draft/preset", {
      body: { preset, scheme: FIRST_SCHEME[preset], draft_version: version },
    });
    const body = expect(applied, 200, `the ${preset} preset`).body;
    version = body.draft_version;
    for (const plate of ["none", "plate"]) {
      const { primary, accent, scheme } = body.manifest.brand;
      const kind = plate === "none" ? "none" : "light";
      const set = await demo.call("PUT", "/api/theming/draft/brand", {
        body: {
          draft_version: version,
          primary,
          accent,
          scheme,
          logo: body.manifest.images.logo,
          logo_plate: { kind, shape: "rounded", padding: "medium" },
        },
      });
      version = expect(set, 200, `the ${preset} plate`).body.draft.draft_version;
      for (const [name, viewport, o] of PLATES.filter(
        ([, , p]) => p.preset === preset && p.plate === plate,
      )) {
        await shot(name, o.path, viewport, SESSION, { fullPage: false });
      }
    }
  }
  return version;
}
