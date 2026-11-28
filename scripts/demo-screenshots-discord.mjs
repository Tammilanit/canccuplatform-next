// The Discord page's shots of the front pass (#765; scripts/demo-screenshots-front.mjs), beside
// mockups 02 to 04, 06, 13 and 15 of the step 6 brief, against the fake Discord: the setup on
// demo-two, which has no server; the archived event's page; then the demo event's tabs, bound by
// demo-screenshots-front.sql to the guild the run made, each change made through the page.
const UNBOUND = "demo-two.localhost";
const SHARED_BOT = "100000000000000002"; // deploy/compose.ci.yml
// Add to Discord opens Discord's install page for the shared bot with a fresh state; the page is
// stood in for here, since a browser on the stack cannot open the fake's.
const addToDiscord = async (page) => {
  let asked = "";
  await page.route(/\/oauth2\/authorize\?/, (route) => {
    asked = route.request().url();
    return route.fulfill({ contentType: "text/html", body: "<p>Discord</p>" });
  });
  await Promise.all([
    page.waitForURL(/\/oauth2\/authorize\?/),
    page.click("text=Add to Discord"),
  ]);
  const query = new URL(asked).searchParams;
  if (query.get("client_id") !== SHARED_BOT || !query.get("state"))
    throw new Error("Add to Discord opened no install page of the shared bot");
  await page.goBack();
};
// A change through the contract's API, then the page with its answer.
const change = (button, done) => async (page) => {
  page.on("dialog", (dialog) => dialog.accept());
  await Promise.all([
    page.waitForURL(new RegExp(`done=${done}`)),
    page.click(`button:has-text("${button}")`),
  ]);
};
const openTabMenu = (page) => page.click(".bot-tabmenu summary");

/** The shots, in the front pass's form; `DESK` and the rest are the pass's own. */
export const discordShots = ({ DESK, PHONE, ARCHIVED, EVENT_ADMIN }) => [
  [
    "discord-setup",
    "/bot/",
    DESK,
    { host: UNBOUND, text: "Which bot speaks for", act: addToDiscord },
  ],
  [
    "discord-setup-phone",
    "/bot/",
    PHONE,
    { host: UNBOUND, text: "Add it to your server" },
  ],
  [
    "discord-bind-refused-phone",
    "/bot/?bind=manage_server_required",
    PHONE,
    { host: UNBOUND, text: "You need Manage Server there" },
  ],
  ["discord-archived", "/bot/", DESK, { host: ARCHIVED, text: "is archived" }],
  [
    "discord-channels-missing",
    "/bot/channels?setup=1",
    DESK,
    { text: "Missing" },
  ],
  [
    "discord-channels",
    "/bot/channels",
    DESK,
    {
      text: "Created what could be made",
      act: change("Create what is missing", "created"),
    },
  ],
  ["discord-channels-phone", "/bot/channels", PHONE, { text: "Bound" }],
  [
    "discord-check",
    "/bot/check",
    DESK,
    { text: "Checked again", act: change("Check again", "checked") },
  ],
  ["discord-check-phone", "/bot/check", PHONE, { text: "to fix" }],
  ...[DESK, PHONE].map((viewport) => [
    `discord-commands${viewport === PHONE ? "-phone" : ""}`,
    "/bot/commands",
    viewport,
    // Its feature switches take the tenants right the event admin holds.
    { cookie: EVENT_ADMIN, text: "Always on" },
  ]),
  ...[DESK, PHONE].map((viewport) => [
    `discord-overview${viewport === PHONE ? "-phone" : ""}`,
    "/bot/",
    viewport,
    { text: "What happened" },
  ]),
  [
    "discord-tab-menu-phone",
    "/bot/",
    PHONE,
    { text: "Six cards and what happened", act: openTabMenu },
  ],
  // Last: unbinding leaves the demo event as the passes after this one found it.
  [
    "discord-unbound",
    "/bot/",
    DESK,
    {
      text: "The server is unbound",
      act: change("Unbind Demo Community", "unbound"),
    },
  ],
];
