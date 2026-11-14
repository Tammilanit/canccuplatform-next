// The pages of scripts/demo-screenshots.mjs that open at one URL each: the organiser shell, a part's
// Settings in each state of its save bar, Health with a part down (the `--trouble` pass), the
// menu's Health note on other modules' shells (`--trouble` and `--agenda-down`), and the front door
// and error family. Their group is the one their path names
// (scripts/demo-screenshots-groups.mjs). A new page joins here.
import { writeFileSync } from "node:fs";
import { SESSION, expect } from "../modules/screen/test/stack/client.mjs";
import { DESK, PHONE, WIDE, firstLine } from "./demo-screenshots-shot.mjs";

export const CHECK_IN = "@check-in";
// Each surface people use, at the width they use it at, full page. A new page joins here. The
// organiser shell's pages are shot at both widths: on a phone the menu becomes the bottom bar.
const SHELL = [
  ["settings", "/admin/settings"],
  ["health-view", "/admin/health-view"],
  ["profile", "/admin/profile"],
  ["people", "/admin/people"],
  ["notify-topics", "/notify/admin/topics"],
];
export const PAGES = [
  ...SHELL.flatMap(([name, path]) => [
    [name, path, DESK],
    [`${name}-phone`, path, PHONE],
  ]),
  ["settings-wide", "/admin/settings", WIDE],
  ["settings-admin", "/admin/settings/admin", DESK],
  ["studio-advanced", "/theming/studio/advanced", DESK],
  ["studio-history", "/theming/studio/history", DESK],
  ["hub-preview-phone", "/theming/studio/preview/hub", PHONE],
  // Before the fixture fills the run of show, so its empty state stays checked.
  ["agenda-empty", "/agenda/", DESK],
  ["agenda-new-item", "/agenda/items/new", DESK],
  ["agenda-quick-add-phone", "/agenda/add", PHONE],
  ["notify-new-topic", "/notify/admin/topics/new", DESK],
  ["check-in-phone", CHECK_IN, PHONE],
  // Event profile (sheet 4): Load and Upload ask first.
  ["profile-load-ask", "/admin/profile/load", DESK],
  ["profile-load-ask-phone", "/admin/profile/load", PHONE],
  ["profile-upload-ask", "/admin/profile/upload", DESK],
];
// A part's Settings (sheet 4): its groups, then each state of the save bar, shot as the window
// shows it, so the bar sits at the foot. The changed field is scrolled to the middle, clear of the
// bar, so its "Was 45." shows; the shot waits out the bar's step aside on a phone, which the scroll
// starts. "Couldn't save" is a save that never reaches the platform.
const SETTINGS_FORM = "/admin/settings/screen";
const OFFLINE = "#canccu-field-offline_after_seconds";
const typed = (value) => async (page) => {
  await page.fill(OFFLINE, value);
  await page
    .locator(OFFLINE)
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(900);
};
const unanswered = async (page) => {
  await page.route(`**${SETTINGS_FORM}`, (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await typed("30")(page);
  await page.click("[data-canccu-save]");
  await page.locator("[data-canccu-unanswered]:not([hidden])").waitFor();
};
export const SETTINGS_STATES = [
  ["settings-screen", DESK, {}],
  ["settings-screen-change", DESK, { ready: typed("30"), fullPage: false }],
  [
    "settings-screen-change-phone",
    PHONE,
    { ready: typed("30"), fullPage: false },
  ],
  ["settings-screen-invalid", DESK, { ready: typed("3"), fullPage: false }],
  ["settings-screen-failed", DESK, { ready: unanswered, fullPage: false }],
];
// Health with a part down (sheet 4), and the menu saying so: the second pass, `--trouble`, which
// scripts/demo-screenshots runs while it holds notify stopped. On the desktop shot, the page
// follows a check with notify's "What to check" open (health.js): the run fails if the page
// reloads instead of swapping the check in, or if the open "What to check" closes.
const LAST_CHECK = '[data-canccu-live="last-check"]';
const NOTIFY_WAY = 'details[data-canccu-part="notify"]';
const followsACheck = async (page) => {
  await page.click(`${NOTIFY_WAY} > summary`);
  const before = await page.locator(LAST_CHECK).textContent();
  // Gone with the document if the page reloads.
  await page.evaluate(() => (window.canccuSameDocument = true));
  await page.waitForFunction(
    ([sel, was]) => document.querySelector(sel)?.textContent !== was,
    [LAST_CHECK, before],
    { timeout: 30000 },
  );
  if (!(await page.evaluate(() => window.canccuSameDocument === true)))
    throw new Error("Health reloaded the page instead of swapping the check");
  if (!(await page.locator(NOTIFY_WAY).evaluate((way) => way.open)))
    throw new Error('an open "What to check" closed when a check came in');
};
// Last, the page asks scripts/demo-screenshots to start notify again (a file in the work
// directory, which it watches) and must clear the menu's "1 down" from a check, not a reload.
const HEALTH_NOTE = 'a.canccu-menu__item[href$="/health-view"] .canccu-badge';
const followsRecovery = async (page) => {
  if (!(await page.locator(HEALTH_NOTE).count()))
    throw new Error("the menu's Health item has no note while notify is down");
  await page.evaluate(() => (window.canccuSameDocument = true));
  writeFileSync("start-notify", "");
  await page.waitForFunction(
    (sel) => !document.querySelector(sel),
    HEALTH_NOTE,
    { timeout: 90000 },
  );
  if (!(await page.evaluate(() => window.canccuSameDocument === true)))
    throw new Error("Health reloaded the page instead of swapping the check");
};
// Every module's shell says so too (#478): its menu's note comes from admin after the page loads
// (admin's shell.js), and the shot waits for it.
const noted = async (page) => {
  await page.locator(HEALTH_NOTE).waitFor({ timeout: 30000 });
};
export const TROUBLE = [
  ["health-view-trouble", "/admin/health-view", DESK, { ready: followsACheck }],
  ["health-view-trouble-phone", "/admin/health-view", PHONE, {}],
  ["agenda-trouble", "/agenda/", DESK, { ready: noted }],
  ["screen-devices-trouble", "/admin/screen/devices", DESK, { ready: noted }],
  [
    "health-view-recovered",
    "/admin/health-view",
    DESK,
    { ready: followsRecovery },
  ],
];
// Notify's own page can't be shot while notify is down: the third pass, `--agenda-down`, which
// scripts/demo-screenshots runs while it holds the run of show stopped.
export const AGENDA_DOWN = [
  ["notify-topics-trouble", "/notify/admin/topics", DESK, { ready: noted }],
];
// The front door, signed out, and one page of the error family (an item that does not exist),
// each at both widths. The error page must answer its own status, not 200.
const SIGN_IN = "/admin/sign-in";
async function typeNight(page) {
  await page.fill('input[name="at"]', "00:30");
  await page.waitForTimeout(200);
}
const MISSING = "/agenda/items/00000000-0000-0000-0000-000000000000/delay";
export const OTHERS = [
  ["sign-in", SIGN_IN, DESK, { cookie: null }],
  ["sign-in-phone", SIGN_IN, PHONE, { cookie: null }],
  ["error-not-found", MISSING, DESK, { status: 404 }],
  ["error-not-found-phone", MISSING, PHONE, { status: 404 }],
  // Quick add with a time after midnight typed: the next day picked, said why, and the button
  // repeating day and time (#434).
  ["agenda-quick-add-night-phone", "/agenda/add", PHONE, { ready: typeNight }],
];

/** The dry run's lines of the trouble and agenda-down passes. */
export function troubleListed(at) {
  const listed = (list, pass) =>
    list.map(
      ([name, path, { width, height }]) =>
        `  ${name}.png  ${at(path)}  (${width}×${height}, ${pass})`,
    );
  return [
    ...listed(TROUBLE, "--trouble"),
    ...listed(AGENDA_DOWN, "--agenda-down"),
  ];
}

/** The dry run's lines of the first pass's pages, in the order they are shot. */
export function pagesListed(at) {
  const lines = [];
  for (const [name, path, { width, height }] of PAGES) {
    const shown =
      path === CHECK_IN ? "/notify/check-in?p=arrival&c=<a fresh code>" : path;
    lines.push(`  ${name}.png  ${at(shown)}  (${width}×${height})`);
  }
  for (const [name, { width, height }] of SETTINGS_STATES) {
    lines.push(`  ${name}.png  ${at(SETTINGS_FORM)}  (${width}×${height})`);
  }
  for (const [name, path, { width, height }, o] of OTHERS) {
    const how =
      o.cookie === null
        ? ", signed out"
        : o.status
          ? `, answering ${o.status}`
          : "";
    lines.push(`  ${name}.png  ${at(path)}  (${width}×${height}${how})`);
  }
  return lines;
}

// Saved changes, so Settings shows when its parts last changed and what changed.
async function changeSettings(demo, module, values) {
  const now = expect(
    await demo.call("GET", `/api/admin/settings/${module}`),
    200,
    `the ${module} settings`,
  ).body;
  const body = {
    settings_version: now.settings_version,
    values: { ...now.values, ...values(now.values) },
  };
  const put = await demo.call("PUT", `/api/admin/settings/${module}`, { body });
  expect(put, 200, `a change to the ${module} settings`);
}

/** The first pass's pages: Settings first changed when admin's shots are taken. */
export async function pageShots({ demo, at, shot, fail, admin }) {
  if (admin) {
    try {
      await changeSettings(demo, "screen", (v) => ({
        offline_after_seconds: v.offline_after_seconds === 60 ? 45 : 60,
      }));
      await changeSettings(demo, "admin", () => ({
        timezone: "UTC",
        language: "en",
      }));
    } catch (err) {
      fail(`settings changes: ${firstLine(err)}`);
    }
  }
  for (const [name, page, viewport] of PAGES) {
    let path = page;
    if (path === CHECK_IN) {
      // The code rotates (contracts/notify.md, Check-in), so it is fetched right before its shot.
      try {
        const code = await demo.call(
          "GET",
          "/api/notify/check-in/code?purpose=arrival",
        );
        const url = new URL(
          expect(code, 200, "the check-in code").body.url,
          at("/"),
        );
        path = url.pathname + url.search;
      } catch (err) {
        fail(`${name}: ${firstLine(err)}`);
        continue;
      }
    }
    await shot(name, path, viewport, SESSION);
  }
  for (const [name, viewport, o] of SETTINGS_STATES) {
    await shot(name, SETTINGS_FORM, viewport, SESSION, o);
  }
  for (const [name, path, viewport, o] of OTHERS) {
    await shot(name, path, viewport, o.cookie === null ? null : SESSION, o);
  }
}
