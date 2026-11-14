// Preview on a screen (#444; mockup 08, design sheet 6), shot while the Screen studio's screens
// play (studio-shots.mjs): the zone editor's dialog and its notice, the hall screen with its
// "Preview" mark, and the Theme studio's dialog and notice on a draft made for it. Every preview
// and the draft are removed afterwards, so the shots after these see the live zone.
import { markCoversNothing } from "./clear.mjs";
import { expect } from "./client.mjs";

const DESK = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const HD = { width: 1920, height: 1080 };

const open = (control, rows) => async (page) => {
  await page.click(control);
  await page.locator(rows).first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(300);
};
const noticed = async (page) => {
  await page.locator("[data-screen-preview-notice]:not([hidden])").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
};
const marked = async (page) => {
  await page.locator(".canccu-preview-mark").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  await markCoversNothing(page);
};
// The Theme studio's screen preview is screen's player of the main zone (scripts/demo-screenshots).
const kitDrawn = async (page) => {
  await page
    .frameLocator("iframe[data-screen-preview]")
    .locator(".canccu-widget--agenda_now")
    .first()
    .waitFor({ timeout: 40_000 });
};

export const PREVIEW_PAGES = [
  ["screen-zone-preview-dialog", "/admin/screen/zones/main", DESK],
  ["screen-zone-preview-notice", "/admin/screen/zones/main", DESK],
  ["screen-zone-preview-notice-phone", "/admin/screen/zones/main", PHONE],
  ["screen-preview-mark", "/screen/", HD],
  ["studio-screen-dialog", "/theming/studio/", DESK],
  ["studio-screen-notice", "/theming/studio/", DESK],
  ["studio-screen-notice-phone", "/theming/studio/", PHONE],
];

export async function previewShots({ demo, shot, hall, ready }) {
  const preview = `/api/screen/devices/${hall.id}/preview`;
  let draft = null;
  try {
    await shot("screen-zone-preview-dialog", "/admin/screen/zones/main", DESK, {
      ready: async (page) => {
        await ready(page);
        await open("[data-screen-preview-open]", "input[name=preview_device]")(page);
      },
      fullPage: false,
    });
    // The zone as Dashboard, unsaved: only the hall screen shows it.
    const zone = { key: "main", name: "Main hall", layout_id: "dashboard" };
    expect(await demo.call("PUT", preview, { body: { minutes: 5, zone } }), 200, "a zone preview");
    const editorNoticed = async (page) => {
      await ready(page);
      await noticed(page);
    };
    await shot("screen-zone-preview-notice", "/admin/screen/zones/main", DESK, {
      ready: editorNoticed,
    });
    await shot("screen-zone-preview-notice-phone", "/admin/screen/zones/main", PHONE, {
      ready: editorNoticed,
    });
    await shot("screen-preview-mark", "/screen/", HD, {
      cookie: hall.cookie,
      ready: marked,
      fullPage: false,
    });
    const made = await demo.call("POST", "/api/theming/draft", { body: { from: "current" } });
    draft = expect(made, 201, "a draft").body.draft_version;
    await shot("studio-screen-dialog", "/theming/studio/", DESK, {
      ready: async (page) => {
        await kitDrawn(page);
        await open('[data-screen-preview="open"]:visible', ".canccu-studio-screen")(page);
      },
      fullPage: false,
    });
    const key = expect(
      await demo.call("POST", "/api/theming/draft/preview-key"),
      201,
      "a draft preview key",
    ).body.preview_key;
    expect(
      await demo.call("PUT", preview, { body: { minutes: 5, theme_preview_key: key } }),
      200,
      "a draft preview",
    );
    const kitNoticed = async (page) => {
      await kitDrawn(page);
      await noticed(page);
    };
    await shot("studio-screen-notice", "/theming/studio/", DESK, { ready: kitNoticed });
    await shot("studio-screen-notice-phone", "/theming/studio/", PHONE, { ready: kitNoticed });
  } finally {
    await demo.call("DELETE", preview).catch(() => undefined);
    if (draft !== null) {
      await demo.call("DELETE", `/api/theming/draft?draft_version=${draft}`).catch(() => undefined);
    }
  }
}
