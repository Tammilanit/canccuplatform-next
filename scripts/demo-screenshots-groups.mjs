// The screenshot groups and the path map of the demo stack's tiers (#461, docs/ci.md#tiers):
// which group each shot belongs to, which shard takes each group, and what a changed path needs.
// scripts/demo-stack-plan.mjs reads the map; scripts/demo-screenshots.mjs and its front pass take
// the shots of the groups they are given. A PR that adds a page under a new prefix, or a module
// with pages, adds it here (AGENTS.md, A package run).

/** One group per surface: the module serving the page, with screen's two kinds apart. */
export const GROUPS = [
  "admin",
  "agenda",
  "notify",
  "theming",
  "screens",
  "screen-studio",
];

/** The groups a `--groups a,b` option names; a typo fails the run rather than skip its shots. */
export function pickGroups(list) {
  const picked = list.split(",").filter(Boolean);
  for (const g of picked)
    if (!GROUPS.includes(g)) throw new Error(`unknown group ${g}`);
  return new Set(picked);
}

// Longest prefix first: the Screen studio is served under /admin/.
const PAGE_GROUPS = [
  ["/admin/screen/", "screen-studio"],
  ["/admin/", "admin"],
  ["/agenda/", "agenda"],
  ["/notify/", "notify"],
  ["/theming/", "theming"],
  ["/screen/", "screens"],
];

/** The group of a shot, from the path of the page it opens. */
export function groupOf(path) {
  const hit = PAGE_GROUPS.find(([prefix]) => path.startsWith(prefix));
  if (!hit)
    throw new Error(
      `${path}: no screenshot group (scripts/demo-screenshots-groups.mjs)`,
    );
  return hit[1];
}

// Each shard runs on a stack of its own. Balanced on the last full run (2026-11-13): the pages
// with the front and trouble passes about 3 min, the screens of every theme 4.5, the Screen
// studio 2.5.
export const SHARDS = [
  { shard: "pages", groups: ["admin", "agenda", "notify", "theming"] },
  { shard: "screens", groups: ["screens"] },
  { shard: "studio", groups: ["screen-studio"] },
];

// What a changed path needs, first match wins (a `*` also matches `/`): `docs` (no stack),
// `full` (everything, as on main), or the screenshot groups of a module (none: its API tests and
// the platform smoke only). A path no line matches is the full run, so a new kind of file is never
// skipped by mistake.
const MAP = [
  ["*.md", "docs"],
  ["docs/*", "docs"],
  ["contracts/*", "docs"],
  // Shared: every surface draws on these, and the scripts and the workflow are the check itself.
  ["packages/*", "full"],
  ["deploy/*", "full"],
  ["events/demo/*", "full"],
  ["modules/theming/*", "full"],
  ["modules/screen/player/*", "full"],
  ["modules/screen/test/stack/*", "full"],
  [".github/workflows/demo-stack.yml", "full"],
  [".github/actions/demo-stack-up/*", "full"],
  ["scripts/demo-*", "full"],
  ["scripts/screen-soak", "full"],
  ["modules/admin/*", ["admin"]],
  // People and the sign-in page's events come from tenants.
  ["modules/tenants/*", ["admin"]],
  ["modules/agenda/*", ["agenda"]],
  ["modules/notify/*", ["notify"]],
  ["modules/screen-render/*", ["screens"]],
  ["modules/screen/*", ["screens", "screen-studio"]],
  ["modules/*", []],
];

// Contract files a module's image copies and reads at runtime (its Dockerfile): a change to one is
// a change to that module, not a doc.
const READ_AT_RUNTIME = new Map([
  ["contracts/profile.schema.json", "admin"],
  ["contracts/theme.schema.json", "theming"],
  ["contracts/flags.yaml", "tenants"],
]);
const asModule = (path) =>
  READ_AT_RUNTIME.has(path)
    ? `modules/${READ_AT_RUNTIME.get(path)}/${path}`
    : path;

/** The module a changed path of a module tier belongs to. */
export const moduleOf = (path) => asModule(path).split("/")[1];

// scripts/demo-stack-test has tests of admin, agenda, notify and screen only: tenants serves
// admin's People and sign-in, screen-render renders for screen.
const API_OF = { tenants: "admin", "screen-render": "screen" };

/** The module whose API tests (scripts/demo-stack-test --only) cover a module. */
export const apiOf = (module) => API_OF[module] ?? module;

const glob = (pattern) =>
  new RegExp(
    `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
  );
const RULES = MAP.map(([pattern, needs]) => [glob(pattern), needs]);

/** `docs`, `full` or the screenshot groups a changed path needs. */
export function needsOf(path) {
  const own = asModule(path);
  return RULES.find(([re]) => re.test(own))?.[1] ?? "full";
}
