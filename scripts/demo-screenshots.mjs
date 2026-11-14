// The views scripts/demo-screenshots takes (#376), in one Chromium: every user-facing surface of
// the demo event, signed in with the CI session stub's cookie (deploy/compose.ci.yml), and the
// screens of every demo theme with their readability check (#191,
// modules/screen/test/stack/screens.mjs). A user-visible PR's reviewer holds them against the
// mockups (AGENTS.md, A package run). A page that does not answer its own status or whose API
// reads are refused, a screen that does not draw the event, or a screen whose text does not read
// from across a hall fails the run, so a screenshot of an error never passes for a real one. Runs
// in Caddy's network namespace (scripts/demo-screenshots says why).
// The lists live by group, next to what they need: demo-screenshots-pages.mjs (one URL each),
// -agenda.mjs, -theming.mjs, and the screens' and Screen studio's in modules/screen/test/stack/.
// This file picks the groups and keeps the order, which the shots depend on.
// Usage: node demo-screenshots.mjs [--dry-run] [--base BASE_URL] [--out DIR] [--groups LIST] [--check]
//   --groups  only these screenshot groups (scripts/demo-screenshots-groups.mjs; default all): a
//             shard of CI's demo stack, or a module PR's surfaces (docs/ci.md#tiers).
//   --check   the merge queue's pass: every check, no 4K screen, no PNG of a page.
import { mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  DEMO_HOST,
  SCREEN,
  SESSION,
  event,
  expect,
} from "../modules/screen/test/stack/client.mjs";
import {
  guestReads,
  publishTheme,
  seedScreens,
} from "../modules/screen/test/stack/fixture.mjs";
import {
  THEMES,
  planned,
  screenShots,
} from "../modules/screen/test/stack/screens.mjs";
import {
  PLAYLIST_PAGES,
  LAYOUT_PAGES,
  SCHEDULE_PAGES,
  STUDIO_PAGES,
  FROZEN_PAGES,
  studioShots,
} from "../modules/screen/test/stack/studio-shots.mjs";
import { PREVIEW_PAGES } from "../modules/screen/test/stack/preview-shots.mjs";
import {
  CANCELLED,
  DAY_VIEW,
  ITEM_PAGES,
  agendaListed,
  dayShots,
  itemShots,
  removeMade,
} from "./demo-screenshots-agenda.mjs";
import { GROUPS, groupOf, pickGroups } from "./demo-screenshots-groups.mjs";
import {
  AGENDA_DOWN,
  CHECK_IN,
  OTHERS,
  PAGES,
  SETTINGS_STATES,
  TROUBLE,
  pageShots,
  pagesListed,
  troubleListed,
} from "./demo-screenshots-pages.mjs";
import { cookieOn, firstLine, shooter } from "./demo-screenshots-shot.mjs";
import {
  DRAFT,
  LIGHT,
  STUDIO,
  brandKitShots,
  draftShots,
  themingListed,
} from "./demo-screenshots-theming.mjs";

const { values: opts } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    base: { type: "string", default: "http://127.0.0.1" },
    out: { type: "string", default: "screenshots" },
    trouble: { type: "boolean", default: false },
    "agenda-down": { type: "boolean", default: false },
    groups: { type: "string", default: GROUPS.join(",") },
    check: { type: "boolean", default: false },
  },
});
const wanted = pickGroups(opts.groups);
const want = (group) => wanted.has(group);
const base = new URL(opts.base);
const port = base.port ? `:${base.port}` : "";
// Chromium resolves `*.localhost` to the loopback itself, so the event's hostname reaches Caddy.
const at = (path) => `http://${DEMO_HOST}${port}${path}`;

// Only the groups this run takes (--groups): a shard, or a module PR's surfaces.
const only = (list, group) =>
  list.splice(0, list.length, ...list.filter((entry) => want(group(entry))));
// The Health shots are admin's; the other pages' shots, their own module's.
only(TROUBLE, ([, path]) => groupOf(path));
only(AGENDA_DOWN, ([, path]) => groupOf(path));
only(PAGES, ([, path]) => groupOf(path === CHECK_IN ? "/notify/" : path));
only(SETTINGS_STATES, () => "admin");
only(OTHERS, ([, path]) => groupOf(path));
for (const list of [STUDIO, DRAFT, LIGHT]) only(list, () => "theming");
for (const list of [DAY_VIEW, ITEM_PAGES, CANCELLED])
  only(list, () => "agenda");
// The Screen studio's lists are studio-shots.mjs's own, and taken all or none.
const studio = (list) => (want("screen-studio") ? list : []);

if (opts["dry-run"]) {
  const would = opts.check
    ? "check, writing no PNG of a page"
    : `screenshot into ${opts.out}/`;
  const lines = [
    `dry run, would ${would}:`,
    ...troubleListed(at),
    ...pagesListed(at),
    ...themingListed(at),
    ...agendaListed(at),
  ];
  for (const name of want("screens") ? planned(opts.check) : []) {
    lines.push(`  ${name}.png  ${at("/screen/")}  (a paired screen)`);
  }
  const studioLists = [
    [STUDIO_PAGES, "while two screens play"],
    [PREVIEW_PAGES, "while a preview on a screen runs"],
    [FROZEN_PAGES, "while frozen"],
    [PLAYLIST_PAGES, "with a playlist and its push"],
    [LAYOUT_PAGES, "the box editor, unsaved"],
    [SCHEDULE_PAGES, "on windows made for it"],
  ];
  for (const [list, how] of studioLists)
    for (const [name, path, { width, height }] of studio(list))
      lines.push(`  ${name}.png  ${at(path)}  (${width}×${height}, ${how})`);
  console.log(lines.join("\n"));
  process.exit(0);
}

// client.mjs calls screen in its own namespace; here every call goes through Caddy, which routes
// each module's API by its path prefix, and the screen's calls then come from the loopback too.
Object.assign(SCREEN, { host: base.hostname, port: Number(base.port || 80) });
const demo = event(DEMO_HOST);
const { chromium } = await import("playwright-core");
mkdirSync(opts.out, { recursive: true });

const failures = [];
const fail = (what) => {
  failures.push(what);
  console.log(`FAIL ${what}`);
};
let count = 0;
const ok = (what) => {
  console.log(`ok   ${what}`);
  count++;
};

const browser = await chromium.launch();
const shot = shooter({ browser, at, out: opts.out, check: opts.check, fail, ok });
const run = { demo, at, shot, fail };

if (opts.trouble || opts["agenda-down"]) {
  for (const [name, path, viewport, how] of opts.trouble
    ? TROUBLE
    : AGENDA_DOWN) {
    await shot(name, path, viewport, SESSION, how);
  }
  await browser.close();
  if (failures.length) process.exit(1);
  console.log(`demo-screenshots: ${count} views in ${opts.out}/`);
  process.exit(0);
}

try {
  await pageShots({ ...run, admin: want("admin") });
  if (want("agenda")) await itemShots(run);
  // Gone before the fixture: it finds its run of show by title and would take these.
  await removeMade(demo, fail);

  // The fixture's run of show, ticker and zones, which the day view and the studios draw (the
  // screens seed it themselves).
  if (want("agenda") || want("theming") || want("screen-studio")) {
    try {
      await seedScreens(demo);
      await dayShots(run);
    } catch (err) {
      fail(`the run of show's day: ${firstLine(err)}`);
    }
  }

  // A guest who never checked in reads every public page; the screens play without it too.
  try {
    await guestReads(demo);
  } catch (err) {
    fail(`guest: ${firstLine(err)}`);
  }
  if (want("screens")) {
    try {
      await screenShots({
        browser,
        demo,
        at,
        out: opts.out,
        cookieOn,
        check: opts.check,
        fail,
        ok,
      });
    } catch (err) {
      fail(`screens: ${firstLine(err)}`);
    }
  } else if (want("theming") || want("screen-studio")) {
    // Without the screens in this run, the themes they publish, in their order, so the studios
    // draw the same look and history as in one run of every group.
    try {
      for (const theme of THEMES) await publishTheme(demo, theme);
    } catch (err) {
      fail(`the screens' themes: ${firstLine(err)}`);
    }
  }
  await brandKitShots(run);
  if (want("theming")) {
    // After the screens, so the zone plays the fixture's run of show.
    try {
      await draftShots(run);
    } catch (err) {
      fail(`studio draft: ${firstLine(err)}`);
    }
  }
  if (want("screen-studio")) {
    // The Screen studio, on the fixture and theme the screens left.
    try {
      await studioShots({
        browser,
        demo,
        at,
        cookieOn,
        // A screen's own view (the preview's mark) is shot with its device cookie.
        shot: (name, path, viewport, o) =>
          shot(name, path, viewport, o?.cookie ?? SESSION, o),
      });
    } catch (err) {
      fail(`studio: ${firstLine(err)}`);
    }
  }
} finally {
  await browser.close();
  await removeMade(demo, fail);
  // The pairing frame leaves an open code of the 3 the loopback may hold (contracts/screen.md,
  // Pairing); the screens revoke their own devices.
  try {
    expect(
      await demo.call("DELETE", "/api/screen/pairing"),
      204,
      "clearing open pairing codes",
    );
  } catch (err) {
    fail(`cleanup: ${firstLine(err)}`);
  }
}

if (failures.length) {
  console.log(`demo-screenshots: ${failures.length} failed`);
  process.exit(1);
}
console.log(`demo-screenshots: ${count} views in ${opts.out}/`);
