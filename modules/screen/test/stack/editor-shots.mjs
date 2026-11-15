// The zone and content editors' states of #540 and #542, shot after the box editor's on the same
// demo fixture (studio-shots.mjs): the photo wall's seconds refused, Choose files reached with the
// keyboard, and a zone whose layout is gone, saved for its shots and put back after them.
import { expect } from "./client.mjs";
import { saveZone } from "./fixture.mjs";

const DESK = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
// A saved size for Pulse's hero that the editor must not draw once the zone's layout is gone.
const STALE_HERO = { column: 1, row: 2, columns: 6, rows: 10 };

/** Name, path, viewport and what the page does before its shot; `gone` ones on the saved zone. */
export const EDITOR_PAGES = [
  ["screen-zone-photo-refused", "/admin/screen/zones/main", DESK, "refuse"],
  ["screen-content-upload-focus", "/admin/screen/content", DESK, "focus"],
  ["screen-zone-layout-missing", "/admin/screen/zones/main", DESK, "gone"],
  ["screen-zone-layout-missing-phone", "/admin/screen/zones/main", PHONE, "gone"],
];

/** `ready` is the Studio pages' own wait (studio-shots.mjs); it presses Preview where there is one. */
const steps = (ready) => ({
  // Preview, pressed by `ready`, stops at the out-of-range seconds with the notice's reason.
  refuse: async (page) => {
    await page.fill('section[data-region="hero"] [name=photo_seconds]', "4");
    await ready(page);
    await page.locator(".canccu-studio-notice:not([hidden])").waitFor({ timeout: 5000 });
  },
  // Into the visually hidden input by Tab, so its button shows the keyboard's focus ring.
  focus: async (page) => {
    await ready(page);
    await page.locator("[data-upload-input]").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
  },
  // Preview draws the Pulse the warning names; a refusal above it would contradict it (#540).
  gone: async (page) => {
    await ready(page);
    const said = page.locator(".canccu-studio-notice:not([hidden])");
    if ((await said.count()) > 0) throw new Error(`Preview refused: ${await said.textContent()}`);
  },
});

export async function editorShots({ demo, shot, ready }) {
  const how = steps(ready);
  const take = async (gone) => {
    for (const [name, path, viewport, step] of EDITOR_PAGES)
      if ((step === "gone") === gone) await shot(name, path, viewport, { ready: how[step] });
  };
  await take(false);
  const main = expect(await demo.call("GET", "/api/screen/zones/main"), 200, "the main zone").body;
  const regions = main.regions ?? {};
  try {
    await saveZone(demo, "main", {
      layout_id: "retired_layout",
      regions: { ...regions, hero: { ...regions.hero, area: STALE_HERO } },
    });
    await take(true);
  } finally {
    await saveZone(demo, "main", { layout_id: main.layout_id, regions });
  }
}
