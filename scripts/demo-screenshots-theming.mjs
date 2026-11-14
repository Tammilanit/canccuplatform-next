// The Theme studio's brand kit shots of scripts/demo-screenshots.mjs (group `theming`; mockup 12,
// design sheet 6), taken after the screens, so its screen preview is screen's player of the main
// zone with the fixture's run of show: first with no draft, then with one in the draft's look, and
// Preview shows it at full size. The shot waits for the Pulse's run of show, never a player that
// has drawn only the event's name. A phone page is shot with the window as tall as the page, so
// the bottom bar sits at its foot, as a phone shows it, not over the middle.
import { readFileSync } from "node:fs";
import { SESSION, expect } from "../modules/screen/test/stack/client.mjs";
import { DESK, PHONE } from "./demo-screenshots-shot.mjs";

const SCREEN_PREVIEW = "iframe[data-screen-preview]";
const LOGO = new URL("../events/demo/assets/logo.svg", import.meta.url);
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
export const STUDIO = [
  ["studio", DESK, { ready: drawn }],
  ["studio-phone", PHONE, { ready: drawn, tall: true }],
];
export const DRAFT = [
  ["studio-draft", DESK, { ready: drawn }],
  ["studio-draft-phone", PHONE, { ready: drawn, tall: true }],
  ["studio-draft-advanced", DESK, { path: "/theming/studio/advanced" }],
  [
    "studio-draft-preview",
    DESK,
    {
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
      `  ${name}.png  ${at("/theming/studio/")}  (${width}×${height}, a light draft, Publish asked)`,
    );
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
 * A draft with mockup 12's brand and the demo logo, which the previews draw before anything is
 * published, then the same brand light; the draft is discarded after. Throws on a failed call.
 */
export async function draftShots({ demo, shot }) {
  const draft = await demo.call("POST", "/api/theming/draft", {
    body: { from: "defaults" },
  });
  let version = expect(draft, 201, "a draft").body.draft_version;
  const logo = await demo.call(
    "PUT",
    `/api/theming/draft/file?path=images/logo.svg&draft_version=${version}`,
    { body: readFileSync(LOGO), type: "image/svg+xml" },
  );
  version = expect(logo, 200, "the draft's logo").body.draft_version;
  const brand = {
    primary: "#ff7a45",
    accent: "#7c5cff",
    scheme: "dark",
    logo: "images/logo.svg",
  };
  const set = await demo.call("PUT", "/api/theming/draft/brand", {
    body: { draft_version: version, ...brand },
  });
  version = expect(set, 200, "the draft's brand").body.draft.draft_version;
  try {
    for (const [name, viewport, o] of DRAFT) {
      await shot(name, o.path ?? "/theming/studio/", viewport, SESSION, o);
    }
    // The same brand, light: Publish asks first (#444, sheet 6, Q11 b: warn only).
    const light = await demo.call("PUT", "/api/theming/draft/brand", {
      body: { draft_version: version, ...brand, scheme: "light" },
    });
    version = expect(light, 200, "a light brand").body.draft.draft_version;
    for (const [name, viewport] of LIGHT) {
      await shot(name, "/theming/studio/", viewport, SESSION, {
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
  } finally {
    // Left behind, the draft would greet the next run's "studio" shot instead of the start.
    const gone = await demo.call(
      "DELETE",
      `/api/theming/draft?draft_version=${version}`,
    );
    expect(gone, 204, "discarding the draft");
  }
}
