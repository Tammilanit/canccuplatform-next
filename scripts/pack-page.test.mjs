// Tests of scripts/pack-page.mjs (#718) on the fixture brief and book in scripts/pack-page-fixture/,
// copied into a throwaway git repo so --check has real refs to compare against.
import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildPage, checkPage, embedded } from "./pack-page.mjs";
import { renderMarkdown } from "./pack-page-markdown.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "pack-page-fixture");
const SCRIPT = join(here, "pack-page.mjs");
// A 1×1 PNG; each test PNG differs by a trailing byte so a mix-up shows.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const png = (n) => Buffer.concat([PNG, Buffer.from([n])]);

let repo;
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const brief = () => join(repo, "docs/briefs/demo-pack.md");
const sheet = (name) => readFileSync(join(repo, "docs/briefs/demo-pack", name));

before(() => {
  repo = mkdtempSync(join(tmpdir(), "pack-page-"));
  cpSync(FIXTURE, repo, { recursive: true });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "fixture");
});
after(() => rmSync(repo, { recursive: true, force: true }));

const commit = (msg) => {
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", msg);
  return git("rev-parse", "HEAD");
};

test("the page has the brief's title, the verdict on top, then the sections in the brief's order", () => {
  const html = buildPage({ md: brief(), verdict: join(repo, "verdict.md") });
  assert.match(html, /<title>Demo brief: the hall screen<\/title>/);
  assert.match(html, /<h1[^>]*>Demo brief: the hall screen<\/h1>/);
  const at = (s) => {
    const i = html.indexOf(s);
    assert.ok(i >= 0, `missing ${s}`);
    return i;
  };
  const order = [
    at("UX verdict:"),
    at('id="goal"'),
    at('id="key-flows"'),
    at('id="the-first-view-attendees"'),
    at('id="every-mockup"'),
    at('id="questions"'),
    at('id="sheets"'),
  ];
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("without a verdict file the page has no verdict block", () => {
  assert.doesNotMatch(buildPage({ md: brief() }), /class="verdict"/);
});

test("the contents list links to every section", () => {
  const html = buildPage({ md: brief() });
  const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
  for (const id of ["goal", "key-flows", "the-first-view-attendees", "every-mockup", "questions", "sheets"]) {
    assert.match(nav, new RegExp(`href="#${id}"`), id);
  }
});

test("every sheet is embedded byte for byte, in Every mockup's order, with its caption", () => {
  const html = buildPage({ md: brief() });
  const sheets = embedded(html);
  assert.deepEqual(
    sheets.map((s) => s.src),
    ["docs/briefs/demo-pack/01-directions.svg", "docs/briefs/demo-pack/02-flow.svg", "docs/briefs/demo-pack/03-extra.svg"],
    "the table's order, then the folder's sheets it does not list",
  );
  for (const s of sheets) assert.ok(s.bytes.equals(sheet(s.src.split("/").pop())), s.src);
  assert.match(html, /<figcaption>[^]*01-directions\.svg[^]*The three directions side by side[^]*the session[^]*<\/figcaption>/);
  assert.match(html, /<figcaption>[^]*03-extra\.svg[^]*not listed in Every mockup[^]*<\/figcaption>/);
});

test("a sheet the brief's text shows becomes a link to its figure, so each sheet is embedded once", () => {
  const html = buildPage({ md: brief() });
  assert.equal(embedded(html).filter((s) => s.src.endsWith("02-flow.svg")).length, 1);
  assert.match(html, /<a class="sheet-link" href="#sheet-02-flow">[^<]*The first view/);
  assert.match(html, /<a href="#sheet-01-directions">01-directions\.svg<\/a>/, "Every mockup's links point at the figures");
});

test("the page is self-contained and works at phone and desktop width in light and dark", () => {
  const html = buildPage({ md: brief() });
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /@media \(prefers-color-scheme: light\)/);
  assert.match(html, /--canccu-page-background:/);
  assert.match(html, /max-width: 100%/);
  assert.doesNotMatch(html, /<script|<link |(?<![-\w])src="(?!data:)/, "no scripts and nothing fetched");
});

test("a book embeds its PNGs from the artifact folder, falling back to the book's own folder, and its SVGs", (t) => {
  const artifact = join(repo, "artifact");
  t.after(() => {
    rmSync(join(repo, "docs/reports/demo-book"), { recursive: true, force: true });
    rmSync(artifact, { recursive: true, force: true });
  });
  mkdirSync(artifact, { recursive: true });
  mkdirSync(join(repo, "docs/reports/demo-book"), { recursive: true });
  writeFileSync(join(artifact, "b01-front.png"), png(1));
  writeFileSync(join(repo, "docs/reports/demo-book/b01-front.png"), png(9));
  writeFileSync(join(repo, "docs/reports/demo-book/b02-front-phone.png"), png(2));
  const html = buildPage({ md: join(repo, "docs/reports/demo-book.md"), images: artifact });
  const shots = embedded(html);
  assert.deepEqual(shots.map((s) => s.mime), ["image/png", "image/svg+xml", "image/png"]);
  assert.ok(shots[0].bytes.equals(png(1)), "the artifact's PNG wins");
  assert.ok(shots[2].bytes.equals(png(2)));
  assert.ok(shots[1].bytes.equals(sheet("01-directions.svg")));
  assert.match(html, /<td><img [^>]*alt="Front page"/, "images stay where the book puts them");
});

test("a missing image stops the build with its name", () => {
  assert.throws(() => buildPage({ md: join(repo, "docs/reports/demo-book.md") }), /b01-front\.png/);
});

test("--check passes when every embedded SVG matches the ref", () => {
  const html = buildPage({ md: brief() });
  const r = checkPage(html, "HEAD", repo);
  assert.equal(r.checked.length, 3);
  assert.deepEqual(r.diffs, []);
});

test("--check fails on a sheet changed at the ref, a sheet missing there, or a page edited by hand", () => {
  const html = buildPage({ md: brief() });
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(repo, "docs/briefs/demo-pack/01-directions.svg"), sheet("01-directions.svg").toString() + " ");
  rmSync(join(repo, "docs/briefs/demo-pack/03-extra.svg"));
  const head = commit("change a sheet");
  const changed = checkPage(html, head, repo).diffs;
  assert.deepEqual(changed.map((d) => d.src), ["docs/briefs/demo-pack/01-directions.svg", "docs/briefs/demo-pack/03-extra.svg"]);
  assert.match(changed[0].reason, /differs/);
  assert.match(changed[1].reason, /not at/);

  const b64 = Buffer.from(sheet("02-flow.svg")).toString("base64");
  const edited = html.replace(b64, Buffer.from(sheet("02-flow.svg").toString().replace("19:52", "19:53")).toString("base64"));
  assert.deepEqual(checkPage(edited, base, repo).diffs.map((d) => d.src), ["docs/briefs/demo-pack/02-flow.svg"]);
  git("reset", "-q", "--hard", base);
});

test("the CLI writes the page, and --check exits 0 on a match, 1 on a difference, 2 on bad usage", () => {
  // Outside the repo: the commits below add every file in it.
  const outDir = mkdtempSync(join(tmpdir(), "pack-page-out-"));
  const out = join(outDir, "page.html");
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: "utf8" });
  assert.equal(run(brief(), "--out", out).status, 0);
  assert.equal(run("--check", "HEAD", out).status, 0);
  writeFileSync(join(repo, "docs/briefs/demo-pack/02-flow.svg"), "<svg/>");
  const head = commit("redraw a sheet");
  const failed = run("--check", head, out);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /02-flow\.svg/);
  assert.equal(run("--check", "HEAD").status, 2);
  assert.equal(run().status, 2);
  git("reset", "-q", "--hard", "HEAD~1");
  rmSync(outDir, { recursive: true });
});

test("Markdown: nested lists, ordered lists, tables with escaped pipes, quotes, code and emphasis", () => {
  const { html } = renderMarkdown(readFileSync(brief(), "utf8"));
  assert.match(html, /<ul>\s*<li>The hero fills the screen:\s*<ul>\s*<li>the clock;<\/li>/);
  assert.match(html, /<ol>\s*<li>The organiser opens Studio\.<\/li>/);
  assert.match(html, /<td>Who <code>picks \| the<\/code> layout\?<\/td>/);
  assert.match(html, /<blockquote>\s*<p><strong>Source update\.<\/strong>/);
  assert.match(html, /<strong>now<\/strong>, with <code>screen\.changed<\/code> as the <em>only<\/em> event/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<a href="README\.md#outline-of-a-research-pack">the briefs' outline<\/a>/);
  assert.match(html, /<hr>/);
});

test("Markdown: headings get GitHub's ids, numbered when they repeat", () => {
  const { headings } = renderMarkdown("## Port, drop or invent\n## 9 · Feeds & LAN\n## Port, drop or invent\n");
  assert.deepEqual(headings.map((h) => h.id), ["port-drop-or-invent", "9--feeds--lan", "port-drop-or-invent-1"]);
});
