// The second pass of scripts/demo-screenshots (#440, #437, #441, #439): the front doors, People
// and an archived event's pages in the states the first pass cannot reach, after
// scripts/demo-screenshots-front.sql seeded people, a session without a role, events before,
// after and away from their venue, and the archived one's item. Each shot must answer its own
// status and show its state's words, so a screenshot of the wrong state fails.
// Usage: node demo-screenshots-front.mjs [--dry-run] [--base BASE_URL] [--out DIR] [--groups LIST]
//          [--check]   (the groups and the check as in demo-screenshots.mjs)
import { mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  DEMO_HOST,
  SCREEN,
  SESSION,
  event,
  expect,
} from "../modules/screen/test/stack/client.mjs";
import { discordShots } from "./demo-screenshots-discord.mjs";
import { GROUPS, groupOf, pickGroups } from "./demo-screenshots-groups.mjs";

const { values: opts } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    base: { type: "string", default: "http://127.0.0.1" },
    out: { type: "string", default: "screenshots" },
    groups: { type: "string", default: GROUPS.join(",") },
    check: { type: "boolean", default: false },
  },
});
const wanted = pickGroups(opts.groups);
const base = new URL(opts.base);
const port = base.port ? `:${base.port}` : "";
const DESK = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const NO_ROLE = "canccu_session=demo-no-role"; // demo-screenshots-front.sql
// Holds the tenants rights the Event page edits with (deploy/compose.ci.yml), so its sections
// are forms; demo-ci reads them only.
const EVENT_ADMIN = "canccu_session=demo-event-admin";
const ARCHIVED = "demo-archived.localhost";
const SOON = "demo-soon.localhost";
const ELSEWHERE = "demo-elsewhere.localhost";
const NO_EVENT = "no-event.localhost"; // no tenant has it, so nothing resolves
const DRAFT = "demo-draft.localhost";
const VENUE_ONLY = "demo-venue-only.localhost"; // its pages open only at a venue CI is not at
// Its organiser chose "Only from the venue's network" (#778), and CI is not at its venue.
const RESTRICTED = "demo-restricted.localhost";
// A well-formed code: the pages that answer before the code is checked never read it.
const ANY_CODE = "/notify/check-in?p=arrival&c=AAAAAAAAAAAAAAAAAAAAAA";
const FRESH = "@fresh"; // a code fetched right before the shot
const STALE = "@stale"; // a code fetched at the start, expired by its shot
const tap = async (page) => {
  await Promise.all([
    page.waitForNavigation(),
    page.click(".canccu-front__card form button"),
  ]);
};
const tapOffline = async (page, context) => {
  await context.setOffline(true);
  await page.click(".canccu-front__card form button");
};

// [name, path, viewport, { cookie, host, status, text, act }]: `text` is what the state says.
const SHOTS = [
  [
    "sign-in-signed-out",
    "/admin/sign-in",
    DESK,
    { text: "You were signed out" },
  ],
  [
    "sign-in-signed-out-phone",
    "/admin/sign-in",
    PHONE,
    { text: "You were signed out" },
  ],
  [
    "sign-in-no-role",
    "/admin/sign-in",
    DESK,
    { cookie: NO_ROLE, text: "No role yet" },
  ],
  [
    "sign-in-no-role-phone",
    "/admin/sign-in",
    PHONE,
    { cookie: NO_ROLE, text: "No role yet" },
  ],
  // A host no event claims (#708): the platform's poster, never an empty column.
  [
    "sign-in-no-event",
    "/admin/sign-in",
    DESK,
    { cookie: null, host: NO_EVENT, text: "Organisers and crew sign in here" },
  ],
  [
    "sign-in-no-event-phone",
    "/admin/sign-in",
    PHONE,
    { cookie: null, host: NO_EVENT, text: "Organisers and crew sign in here" },
  ],
  // An organiser page of an event whose organiser opened it only on the venue's network (#778).
  [
    "error-venue-network-only",
    "/agenda/",
    DESK,
    { host: RESTRICTED, status: 403, text: "Venue network only" },
  ],
  [
    "error-venue-network-only-phone",
    "/agenda/",
    PHONE,
    { host: RESTRICTED, status: 403, text: "Venue network only" },
  ],
  // From another module's page (#474): no role at all lands on "No role yet", not "No access".
  [
    "agenda-no-role-phone",
    "/agenda/",
    PHONE,
    { cookie: NO_ROLE, text: "No role yet" },
  ],
  [
    "sign-in-archived",
    "/admin/sign-in",
    DESK,
    { cookie: null, host: ARCHIVED, text: "look back" },
  ],
  [
    "sign-in-archived-phone",
    "/admin/sign-in",
    PHONE,
    { cookie: null, host: ARCHIVED, text: "look back" },
  ],
  ["offline", "/admin/offline", DESK, { text: "offline" }],
  ["offline-phone", "/admin/offline", PHONE, { text: "offline" }],
  ["people-many", "/admin/people", DESK, { text: "more people" }],
  ["people-many-phone", "/admin/people", PHONE, { text: "more people" }],
  [
    "people-search",
    "/admin/people?q=player&role=none",
    DESK,
    { text: "Player" },
  ],
  ["people-all", "/admin/people?show=all", DESK, { text: "people shown" }],
  [
    "people-changed",
    "/admin/people?changed=u_demo_01&from=none",
    DESK,
    { text: "Undo" },
  ],
  [
    "people-changed-phone",
    "/admin/people?changed=u_demo_01&from=none",
    PHONE,
    { text: "Undo" },
  ],
  [
    "people-remove",
    "/admin/people/u_demo_02/remove",
    DESK,
    { text: "Keep them" },
  ],
  [
    "people-remove-phone",
    "/admin/people/u_demo_02/remove",
    PHONE,
    { text: "Keep them" },
  ],
  [
    "people-person-phone",
    "/admin/people/u_demo_long",
    PHONE,
    { text: "Remove from" },
  ],
  [
    "check-in-sign-in-phone",
    FRESH,
    PHONE,
    { cookie: null, text: "after that it is one tap" },
  ],
  [
    "check-in-cancelled-phone",
    `${FRESH}&signin=cancelled`,
    PHONE,
    { cookie: null, text: "was cancelled" },
  ],
  ["check-in-done-phone", FRESH, PHONE, { act: tap, text: "checked in" }],
  [
    "check-in-again-phone",
    FRESH,
    PHONE,
    { act: tap, text: "already checked in" },
  ],
  [
    "check-in-unreachable-phone",
    FRESH,
    PHONE,
    { act: tapOffline, text: "reach the event" },
  ],
  [
    "check-in-not-open-phone",
    ANY_CODE,
    PHONE,
    { host: SOON, text: "Check-in opens on" },
  ],
  [
    "check-in-closed-phone",
    ANY_CODE,
    PHONE,
    { host: ARCHIVED, text: "Check-in has closed" },
  ],
  [
    "check-in-at-venue-phone",
    ANY_CODE,
    PHONE,
    { host: ELSEWHERE, text: "Check in at the venue" },
  ],
  [
    "check-in-expired-phone",
    STALE,
    PHONE,
    { act: tap, text: "This code has expired" },
  ],
  // An archived event is read-only (#439, sheet 2 and 8): no Quick add in the bar, an item
  // without its actions, and the Studio without what changes something.
  ...[DESK, PHONE].flatMap((viewport) => {
    const phone = viewport === PHONE ? "-phone" : "";
    return [
      [
        `agenda-archived${phone}`,
        "/agenda/?earlier=1&item=demo-archived-show",
        viewport,
        { host: ARCHIVED, text: "is archived, so this item" },
      ],
      [
        `screen-studio-archived${phone}`,
        "/admin/screen/",
        viewport,
        { host: ARCHIVED, text: "nothing in the Screen studio can be changed" },
      ],
    ];
  }),
  // The event's front door at its base address (#750), as a guest sees it in each state; the
  // first pass's run of show gives the open event its now and next.
  ...[DESK, PHONE].flatMap((viewport) => {
    const phone = viewport === PHONE ? "-phone" : "";
    return [
      ["front-door", "/", viewport, { cookie: null, text: "What's on" }],
      [
        "front-door-archived",
        "/",
        viewport,
        { cookie: null, host: ARCHIVED, text: "The event has ended" },
      ],
      [
        "front-door-draft",
        "/",
        viewport,
        { cookie: null, host: DRAFT, text: "Not open yet" },
      ],
      [
        "front-door-venue-only",
        "/",
        viewport,
        { cookie: null, host: VENUE_ONLY, text: "Open at the venue" },
      ],
    ].map(([name, ...rest]) => [`${name}${phone}`, ...rest]);
  }),
  // The Event page as an event admin sees it: Basics, Venue and Modules open for editing (#782).
  ...[DESK, PHONE].map((viewport) => [
    `admin-event-edit${viewport === PHONE ? "-phone" : ""}`,
    "/admin/event",
    viewport,
    { cookie: EVENT_ADMIN, text: "Type to search" },
  ]),
  [
    "privacy-phone",
    "/notify/privacy",
    PHONE,
    { cookie: null, text: "Privacy" },
  ],
  ...discordShots({ DESK, PHONE, ARCHIVED, EVENT_ADMIN }),
  // The bind's result page (#761): a state that names no event, so no event to go back to.
  ...[DESK, PHONE].map((viewport) => [
    `bot-bind-expired${viewport === PHONE ? "-phone" : ""}`,
    `/api/bot/install/callback?state=${"A".repeat(32)}&code=x`,
    viewport,
    { cookie: null, status: 400, text: "This link has run out" },
  ]),
];

// Only the groups this run takes; a fresh or stale code is a check-in page.
const takes = ([, path]) =>
  wanted.has(groupOf(path.startsWith("@") ? "/notify/" : path));
SHOTS.splice(0, SHOTS.length, ...SHOTS.filter(takes));

const at = (path, host = DEMO_HOST) => `http://${host}${port}${path}`;
if (opts["dry-run"]) {
  for (const [name, path, { width, height }, o] of SHOTS) {
    const shown = path
      .replace(FRESH, "/notify/check-in?p=arrival&c=<a fresh code>")
      .replace(STALE, "/notify/check-in?p=arrival&c=<a code a minute old>");
    console.log(`  ${name}.png  ${at(shown, o.host)}  (${width}×${height})`);
  }
  process.exit(0);
}

// Every API call goes through Caddy, as in the first pass (demo-screenshots.mjs says why).
Object.assign(SCREEN, { host: base.hostname, port: Number(base.port || 80) });
const demo = event(DEMO_HOST);
const code = async () => {
  const answer = await demo.call(
    "GET",
    "/api/notify/check-in/code?purpose=arrival",
  );
  const url = new URL(
    expect(answer, 200, "the check-in code").body.url,
    at("/"),
  );
  return url.pathname + url.search;
};
const { chromium } = await import("playwright-core");
mkdirSync(opts.out, { recursive: true });
const failures = [];
let count = 0;
const browser = await chromium.launch();
// A code is valid for its period and the next; it reads as expired for the 10 after those.
const stale = SHOTS.some(([, path]) => path === STALE)
  ? { path: await code(), at: Date.now() }
  : undefined;
try {
  for (const [name, listed, viewport, o] of SHOTS) {
    const host = o.host ?? DEMO_HOST;
    const context = await browser.newContext({ viewport });
    try {
      let path = listed;
      if (path.startsWith(FRESH))
        path = (await code()) + path.slice(FRESH.length);
      if (path === STALE) {
        await new Promise((r) =>
          setTimeout(r, Math.max(0, stale.at + 65000 - Date.now())),
        );
        path = stale.path;
      }
      const cookie = o.cookie === undefined ? SESSION : o.cookie;
      if (cookie) {
        const cut = cookie.indexOf("=");
        await context.addCookies([
          {
            name: cookie.slice(0, cut),
            value: cookie.slice(cut + 1),
            domain: host,
            path: "/",
          },
        ]);
      }
      const page = await context.newPage();
      const res = await page.goto(at(path, host));
      if (res?.status() !== (o.status ?? 200))
        throw new Error(`answered HTTP ${res?.status()}`);
      if (o.act) await o.act(page, context);
      await page
        .waitForLoadState("networkidle", { timeout: 5000 })
        .catch(() => undefined);
      const shown = await page.evaluate(() => document.body.innerText);
      if (!shown.includes(o.text)) throw new Error(`does not say "${o.text}"`);
      if (viewport.width === PHONE.width) {
        const height = await page.evaluate(
          () => document.documentElement.scrollHeight,
        );
        if (height > viewport.height)
          await page.setViewportSize({ ...viewport, height });
      }
      if (!opts.check)
        await page.screenshot({
          path: `${opts.out}/${name}.png`,
          fullPage: true,
        });
      console.log(`ok   ${name}.png`);
      count++;
    } catch (err) {
      failures.push(name);
      console.log(
        `FAIL ${name}: ${String(err?.message ?? err)
          .split("\n")[0]
          .slice(0, 300)}`,
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.log(`demo-screenshots-front: ${failures.length} failed`);
  process.exit(1);
}
console.log(`demo-screenshots-front: ${count} views in ${opts.out}/`);
