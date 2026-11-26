// A Studio page ready for its shot (studio-shots.mjs): its live views drawn and settled.
// Live views keep their streams open, so there is no network idle: each view the page has loaded
// must draw the run of show, then a second lets the entry motion end. Through the iframe element:
// page.frames() gave the page's own document for an iframe the server drew with `src`.
const drawn = (frame) =>
  frame.locator(".canccu-widget--agenda_now").first().waitFor({ timeout: 30_000 });
export async function studioReady(page) {
  // A full-page shot of a page taller than the window resizes the window while it captures, and
  // studio.js then lets go of the live views and loads them again: they were blank in the shot.
  // So the window takes the page's height first, and the capture changes nothing.
  const { width, height } = page.viewportSize();
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  if (full > height) await page.setViewportSize({ width, height: full });
  await page
    .locator("[data-zone-preview]")
    .click({ timeout: 1000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);
  const views = page.locator(".canccu-studio-thumb iframe[src]");
  const count = await views.count();
  for (let i = 0; i < count; i++) await drawn(views.nth(i).contentFrame());
  await page.waitForTimeout(1500);
}
