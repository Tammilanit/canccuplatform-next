// The weekly run's accessibility check (docs/ci.md#weekly, #575): axe-core's WCAG 2.1 A and AA
// rules on every page the screenshots open at one URL (scripts/demo-screenshots-pages.mjs, so a
// new page is checked too) and on the screen's first view, signed in with the CI stub's cookie.
// Serious and critical findings fail; the rest are listed. scripts/a11y-check runs it in the
// Playwright image, in Caddy's network namespace, as scripts/demo-screenshots does.
// Usage: node scripts/a11y-check.mjs --base URL --out DIR [--dry-run]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { SESSION, DEMO_HOST } from "../modules/screen/test/stack/client.mjs";
import { CHECK_IN, PAGES } from "./demo-screenshots-pages.mjs";
import { cookieOn, firstLine } from "./demo-screenshots-shot.mjs";

const FAILS = ["serious", "critical"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// The check-in page needs a fresh arrival code, which only the screenshots' own run makes.
export const PAGES_TO_CHECK = [
  ...PAGES.filter(([, path]) => path !== CHECK_IN),
  ["screen-first-view", "/screen/", { width: 1920, height: 1080 }],
];

export const failing = (results) =>
  results.filter((r) => r.error || r.violations.some((v) => FAILS.includes(v.impact)));

export function markdown(results) {
  const clean = results.filter((r) => !r.error && !r.violations.length).length;
  const rows = results.flatMap((r) =>
    r.error
      ? [`| ${r.name} | ${r.path} | not checked | ${r.error} | | |`]
      : r.violations.map((v) => `| ${r.name} | ${r.path} | ${v.impact} | ${v.id} | ${v.nodes.length} | ${v.help} |`),
  );
  return [
    "# Accessibility (axe-core, WCAG 2.1 A and AA)",
    "",
    `${clean} of ${results.length} pages clean; serious and critical findings fail the run.`,
    "",
    "| Page | Path | Impact | Rule | Elements | Help |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

async function main() {
  const { values } = parseArgs({
    options: { base: { type: "string" }, out: { type: "string" }, "dry-run": { type: "boolean" } },
  });
  const base = new URL(values.base ?? "http://127.0.0.1");
  const at = (path) => `http://${DEMO_HOST}${base.port ? `:${base.port}` : ""}${path}`;
  if (values["dry-run"]) {
    for (const [name, path] of PAGES_TO_CHECK) console.log(`  ${name}  ${at(path)}`);
    return 0;
  }
  const { chromium } = await import("playwright-core");
  const axe = join(process.cwd(), "node_modules/axe-core/axe.min.js");
  const browser = await chromium.launch();
  const results = [];
  for (const [name, path, viewport] of PAGES_TO_CHECK) {
    const context = await browser.newContext({ viewport });
    await context.addCookies([cookieOn(SESSION)]);
    const page = await context.newPage();
    try {
      await page.goto(at(path), { waitUntil: "load", timeout: 30_000 });
      await page.waitForTimeout(500);
      await page.addScriptTag({ path: axe });
      const { violations } = await page.evaluate(
        (tags) => globalThis.axe.run(document, { runOnly: { type: "tag", values: tags } }),
        TAGS,
      );
      results.push({ name, path, violations: violations.map(({ id, impact, help, nodes }) => ({ id, impact, help, nodes })) });
      console.log(`${violations.length ? "found" : "ok   "} ${name} (${violations.length})`);
    } catch (err) {
      results.push({ name, path, error: firstLine(err) });
      console.log(`FAIL ${name}: ${firstLine(err)}`);
    }
    await context.close();
  }
  await browser.close();
  mkdirSync(values.out, { recursive: true });
  writeFileSync(join(values.out, "a11y.json"), `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(join(values.out, "a11y.md"), markdown(results));
  const bad = failing(results);
  for (const r of bad) console.log(`FAIL accessibility of ${r.name} (${r.path})`);
  return bad.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
