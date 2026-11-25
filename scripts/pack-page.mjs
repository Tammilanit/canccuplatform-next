// Builds one self-contained HTML page from a research pack (docs/briefs/<name>.md and its sheets)
// or a screenshot book (docs/reports/<name>.md with a CI demo-screenshots folder), with no AI
// tokens (#718): the lead only writes the short verdict. --check proves a published page still
// shows the sheets of a git ref, byte for byte.
// Usage: node scripts/pack-page.mjs <brief-or-book.md> --out PAGE.html [--verdict FILE.md] [--images DIR]
//        node scripts/pack-page.mjs --check REF PAGE.html
// Exit: 0 done or every sheet matches; 1 a missing image, a difference or nothing to check; 2 usage.
//
// Each image is embedded as a base64 data URI, not as inline <svg>: the decoded bytes are the
// file's, unchanged, and each sheet renders in its own document. Inline, the sheets' <style>
// blocks would restyle each other and the page, and their shared ids (almost every sheet has an
// arrowhead `id="ah"`) would make one sheet draw another's markers.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { escapeHtml, plainText, renderMarkdown, slugger } from "./pack-page-markdown.mjs";
import { PAGE_CSS } from "./pack-page-style.mjs";

const MIME = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const SVG = "image/svg+xml";
const EVERY_MOCKUP = /^#{2,6}\s+Every mockup\s*$/i;

function gitRoot(dir) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return process.cwd();
  }
}

/** The repo path --check reads at a ref, or none for a file outside the repo. */
function repoPath(root, file) {
  const rel = relative(root, file);
  return rel.startsWith("..") ? null : rel.split(sep).join("/");
}

function dataImage(root, file, alt, cls = "") {
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime) throw new Error(`not an image this page can embed: ${file}`);
  const src = repoPath(root, file);
  const data = readFileSync(file).toString("base64");
  // The attribute order is fixed: embedded() reads it back.
  return `<img${cls ? ` class="${cls}"` : ""}${src ? ` data-src="${escapeHtml(src)}"` : ""} src="data:${mime};base64,${data}" alt="${escapeHtml(alt)}" loading="lazy">`;
}

/** The sheets: Every mockup's table in its order, then the folder's other SVGs by name. */
function sheetsOf(md, src) {
  const dir = dirname(md);
  const listed = [];
  const lines = src.split("\n");
  const at = lines.findIndex((l) => EVERY_MOCKUP.test(l));
  if (at >= 0) {
    let i = at + 1;
    while (i < lines.length && !lines[i].trim()) i++;
    for (i += 2; i < lines.length && lines[i].includes("|"); i++) {
      const cells = lines[i].trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
      // A PNG only when listed: a script-built pack's renders (#784). The folder's unlisted files
      // stay SVG only, so a book's screenshots beside it never turn into sheets.
      const k = cells.findIndex((c) => /\]\([^)\s]+\.(?:svg|png)\)/.test(c));
      if (k < 0) continue;
      const [, name, url] = cells[k].match(/\[([^\]]*)\]\(([^)\s]+\.(?:svg|png))\)/);
      const file = resolve(dir, url);
      if (!listed.some((s) => s.file === file)) listed.push({ file, name, caption: cells.filter((_, j) => j !== k) });
    }
  }
  const folder = join(dir, basename(md, ".md"));
  const extra = existsSync(folder)
    ? readdirSync(folder).filter((f) => f.endsWith(".svg")).sort().map((f) => join(folder, f))
        .filter((file) => !listed.some((s) => s.file === file))
        .map((file) => ({ file, name: basename(file), caption: null }))
    : [];
  const id = slugger();
  return [...listed, ...extra].map((s) => ({ ...s, id: id(`sheet-${basename(s.file, extname(s.file))}`) }));
}

export function buildPage({ md, verdict, images }) {
  md = realpathSync(md);
  const root = gitRoot(dirname(md));
  const raw = readFileSync(md, "utf8").replace(/\r\n?/g, "\n");
  const h1 = raw.match(/^# +(.+?)\s*$/m);
  const src = h1 ? raw.replace(h1[0], "") : raw;
  const sheets = sheetsOf(md, src);
  const sheetAt = (url) => sheets.find((s) => s.file === resolve(dirname(md), url.split("#")[0]));
  const missing = [];
  const altOf = new Map();
  const image = (alt, url) => {
    const sheet = sheetAt(url);
    if (sheet) {
      if (!altOf.has(sheet)) altOf.set(sheet, alt);
      return `<a class="sheet-link" href="#${sheet.id}">Sheet: ${escapeHtml(alt || sheet.name)} ↓</a>`;
    }
    const fromArtifact = images ? join(images, basename(url)) : null;
    const file = fromArtifact && existsSync(fromArtifact) ? fromArtifact : resolve(dirname(md), url);
    if (!existsSync(file)) {
      missing.push(url);
      return "";
    }
    return dataImage(root, file, alt);
  };
  const link = (url) => (sheetAt(url) && !/^[a-z]+:/i.test(url) ? `#${sheetAt(url).id}` : url);
  const body = renderMarkdown(src, { image, link });
  if (missing.length) throw new Error(`images not found: ${missing.join(", ")}`);

  const title = h1 ? renderMarkdown(`# ${h1[1]}`).headings[0] : { html: escapeHtml(basename(md, ".md")), text: basename(md, ".md") };
  const taken = new Map(body.headings.map((h) => [h.id, 1]));
  const sheetsId = slugger(taken)("sheets");
  const caption = (s) => {
    const words = s.caption
      ? s.caption.map((c) => renderMarkdown(c).html.replace(/^<p>|<\/p>$/g, "")).join(" · ")
      : escapeHtml(altOf.get(s) || "not listed in Every mockup");
    return `<strong>${escapeHtml(s.name)}</strong> · ${words}`;
  };
  const figures = sheets.map(
    (s) => `<figure id="${s.id}">\n${dataImage(root, s.file, plainText(caption(s)), "sheet")}\n<figcaption>${caption(s)}</figcaption>\n</figure>`,
  );
  const gallery = sheets.length ? `<section class="sheets">\n<h2 id="${sheetsId}">Sheets</h2>\n${figures.join("\n")}\n</section>` : "";
  const toc = [
    ...body.headings.filter((h) => h.level <= 3),
    ...(sheets.length ? [{ level: 2, id: sheetsId, text: "Sheets" }, ...sheets.map((s) => ({ level: 3, id: s.id, text: s.name }))] : []),
  ];
  const verdictHtml = verdict ? `<aside class="verdict">\n${renderMarkdown(readFileSync(verdict, "utf8")).html}\n</aside>` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title.text)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
<h1>${title.html}</h1>
${verdictHtml}
${contents(toc)}
${body.html}
${gallery}
</main>
</body>
</html>
`;
}

function contents(entries) {
  const items = [];
  for (const h of entries) {
    const a = `<a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a>`;
    if (h.level === 2 || !items.length) items.push({ a, sub: [] });
    else items[items.length - 1].sub.push(`<li>${a}</li>`);
  }
  const li = ({ a, sub }) => `<li>${a}${sub.length ? `<ul>${sub.join("")}</ul>` : ""}</li>`;
  return `<nav aria-label="Contents">\n<p class="nav-title">Contents</p>\n<ol>\n${items.map(li).join("\n")}\n</ol>\n</nav>`;
}

/** Every embedded image of a page: its repo path (when it has one), type and decoded bytes. */
export function embedded(html) {
  return [...html.matchAll(/<img\b([^>]*)>/g)].flatMap(([, attrs]) => {
    const data = attrs.match(/ src="data:([^;"]+);base64,([A-Za-z0-9+/=]*)"/);
    if (!data) return [];
    const src = attrs.match(/ data-src="([^"]*)"/);
    const sheet = / class="sheet"/.test(attrs);
    return [{ src: src ? src[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&") : null, mime: data[1], sheet, bytes: Buffer.from(data[2], "base64") }];
  });
}

/**
 * Compares every embedded SVG, and every sheet (a pack's PNG renders too), with its file at ref;
 * diffs name each one that is not identical. A book's screenshots come from a CI artifact, not
 * the ref, so they are not checked.
 */
export function checkPage(html, ref, root) {
  execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: root, stdio: "ignore" });
  const svgs = embedded(html).filter((e) => e.mime === SVG || e.sheet);
  const diffs = [];
  for (const e of svgs) {
    if (!e.src) {
      diffs.push({ src: "(an SVG)", reason: "has no repo path to check" });
      continue;
    }
    let atRef;
    try {
      atRef = execFileSync("git", ["show", `${ref}:${e.src}`], { cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 });
    } catch {
      diffs.push({ src: e.src, reason: `not at ${ref}` });
      continue;
    }
    if (!atRef.equals(e.bytes)) diffs.push({ src: e.src, reason: `differs from ${ref}` });
  }
  return { checked: svgs.map((e) => e.src), diffs };
}

function main() {
  const usage = (msg) => {
    if (msg) console.error(`error: ${msg}`);
    console.error("usage: pack-page <brief-or-book.md> --out PAGE.html [--verdict FILE.md] [--images DIR]\n       pack-page --check REF PAGE.html");
    process.exit(2);
  };
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: { out: { type: "string" }, verdict: { type: "string" }, images: { type: "string" }, check: { type: "string" } },
    });
  } catch (e) {
    usage(e.message);
  }
  const { values, positionals } = args;
  if (positionals.length !== 1) usage();
  const [input] = positionals;
  if (!existsSync(input)) usage(`${input} not found`);

  if (values.check) {
    let result;
    try {
      result = checkPage(readFileSync(input, "utf8"), values.check, gitRoot(process.cwd()));
    } catch {
      usage(`${values.check} is not a commit here`);
    }
    for (const d of result.diffs) console.error(`mismatch: ${d.src} ${d.reason}`);
    if (!result.checked.length) console.error("error: the page embeds no SVG to check");
    if (result.diffs.length || !result.checked.length) process.exit(1);
    console.log(`${result.checked.length} SVG sheets match ${values.check}`);
    return;
  }

  if (!values.out) usage("--out is required");
  try {
    writeFileSync(values.out, buildPage({ md: input, verdict: values.verdict, images: values.images }));
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
  console.log(`wrote ${values.out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
