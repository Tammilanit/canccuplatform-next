// The Markdown subset the briefs and books use (#718), rendered without a dependency: headings
// with GitHub's ids (so the docs' own #anchors keep working), paragraphs, nested lists, tables,
// quotes, code, rules, links, images and emphasis. Raw HTML is escaped, never passed through:
// the pages are published, and no brief or book uses any.
// Hooks: image(alt, url) returns the HTML for an image; link(url) may rewrite a link's target.

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

export const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const indentOf = (line) => line.match(/^\s*/)[0].replace(/\t/g, "    ").length;
const isTableStart = (lines, i) => lines[i].includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]);
const startsBlock = (lines, i) =>
  HEADING.test(lines[i]) || FENCE.test(lines[i]) || RULE.test(lines[i]) || QUOTE.test(lines[i]) ||
  ITEM.test(lines[i]) || isTableStart(lines, i);

export function renderMarkdown(src, hooks = {}) {
  const ctx = { hooks, headings: [], slugs: new Map() };
  const html = blocks(src.replace(/\r\n?/g, "\n").split("\n"), ctx).join("\n");
  return { html, headings: ctx.headings };
}

/** GitHub's heading anchor: lower case, punctuation dropped, each space a hyphen, repeats numbered. */
export function slugger(slugs = new Map()) {
  return (text) => {
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
    const n = slugs.get(base);
    slugs.set(base, n === undefined ? 1 : n + 1);
    return n === undefined ? base : `${base}-${n}`;
  };
}

export const plainText = (html) =>
  html.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function blocks(lines, ctx) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
    } else if (FENCE.test(line)) {
      const fence = line.match(FENCE)[1];
      const body = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
    } else if (HEADING.test(line)) {
      const [, hashes, text] = line.match(HEADING);
      const inner = inline(text, ctx);
      ctx.slug ??= slugger(ctx.slugs);
      const id = ctx.slug(plainText(inner));
      ctx.headings.push({ level: hashes.length, id, html: inner, text: plainText(inner) });
      out.push(`<h${hashes.length} id="${escapeHtml(id)}">${inner}</h${hashes.length}>`);
      i++;
    } else if (RULE.test(line)) {
      out.push("<hr>");
      i++;
    } else if (QUOTE.test(line)) {
      const body = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) body.push(lines[i].replace(/^\s{0,3}> ?/, ""));
      out.push(`<blockquote>\n${blocks(body, ctx).join("\n")}\n</blockquote>`);
    } else if (isTableStart(lines, i)) {
      i = table(lines, i, ctx, out);
    } else if (ITEM.test(line)) {
      i = list(lines, i, ctx, out);
    } else {
      const para = [line.trim()];
      for (i++; i < lines.length && lines[i].trim() && !startsBlock(lines, i); i++) para.push(lines[i].trim());
      out.push(`<p>${inline(para.join("\n"), ctx)}</p>`);
    }
  }
  return out;
}

// GFM: a pipe escaped as \| is a cell's text, even inside a code span.
const cells = (line) =>
  line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));

function table(lines, i, ctx, out) {
  const head = cells(lines[i]);
  const rows = [];
  for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes("|"); i++) rows.push(cells(lines[i]));
  const tr = (row, tag) =>
    `<tr>${head.map((_, k) => `<${tag}>${inline(row[k] ?? "", ctx)}</${tag}>`).join("")}</tr>`;
  out.push(
    `<div class="table"><table>\n<thead>${tr(head, "th")}</thead>\n<tbody>\n${rows.map((r) => tr(r, "td")).join("\n")}\n</tbody>\n</table></div>`,
  );
  return i;
}

function list(lines, i, ctx, out) {
  const [, lead, marker] = lines[i].match(ITEM);
  const base = indentOf(lead);
  const ordered = /\d/.test(marker);
  const items = [];
  let loose = false;
  while (i < lines.length) {
    const m = lines[i].match(ITEM);
    if (!m || indentOf(m[1]) !== base || /\d/.test(m[2]) !== ordered) break;
    const offset = m[0].length;
    const body = [lines[i].slice(offset)];
    for (i++; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) {
        let j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && indentOf(lines[j]) > base && !isSibling(lines[j], base)) {
          body.push("");
          loose = true;
          continue;
        }
        break;
      }
      if (indentOf(line) > base && !isSibling(line, base)) {
        body.push(line.slice(Math.min(indentOf(line), offset)));
      } else if (!ITEM.test(line) && !startsBlock(lines, i) && body[body.length - 1].trim()) {
        body.push(line.trim()); // a lazy continuation of the item's paragraph
      } else {
        break;
      }
    }
    items.push(body);
    // A blank line between two items makes the list loose: its items keep their <p>.
    let j = i;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j > i && j < lines.length && isSibling(lines[j], base, ordered)) loose = true;
    if (j < lines.length && isSibling(lines[j], base, ordered)) i = j;
    else break;
  }
  const tag = ordered ? "ol" : "ul";
  const start = ordered && parseInt(marker, 10) !== 1 ? ` start="${parseInt(marker, 10)}"` : "";
  const li = (body) => {
    const parts = blocks(body, ctx).map((b) => (!loose && b.startsWith("<p>") ? b.slice(3, -4) : b));
    return `<li>${parts.join("\n")}</li>`;
  };
  out.push(`<${tag}${start}>\n${items.map(li).join("\n")}\n</${tag}>`);
  return i;
}

function isSibling(line, base, ordered) {
  const m = line.match(ITEM);
  return Boolean(m) && indentOf(m[1]) === base && (ordered === undefined || /\d/.test(m[2]) === ordered);
}

// One slot list per top-level call: a link's label is rendered by a nested call that may meet
// the outer call's slots and must restore them too.
function inline(text, ctx, slots = []) {
  const slot = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  const { image, link } = ctx.hooks;
  const href = (url) => escapeHtml(link?.(url) ?? url);
  let s = text
    .replace(/(`+)([^]*?[^`])\1(?!`)/g, (_, __, code) => slot(`<code>${escapeHtml(code.replace(/^ (.*) $/s, "$1"))}</code>`))
    .replace(/<(https?:\/\/[^\s>]+)>/g, (_, url) => slot(`<a href="${href(url)}">${escapeHtml(url)}</a>`))
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, url) =>
      slot(image ? image(alt, url) : `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`),
    );
  // Links last among the slots, so a link's text may hold code and images already slotted.
  const LINK = /\[((?:[^[\]]|\[[^\]]*\])*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  s = s.replace(LINK, (_, label, url) => slot(`<a href="${href(url)}">${inline(label, ctx, slots)}</a>`));
  s = s.replace(/https?:\/\/[^\s<>()\u0000]*[^\s<>().,;:!?'"\u0000]/g, (url) => slot(`<a href="${href(url)}">${escapeHtml(url)}</a>`));
  s = escapeHtml(s)
    .replace(/(\*\*|__)(?=\S)([^]*?\S)\1/g, "<strong>$2</strong>")
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, "$1<em>$2</em>")
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_]*?\S)_(?![\p{L}\p{N}_])/gu, "$1<em>$2</em>")
    .replace(/~~(?=\S)([^]*?\S)~~/g, "<del>$1</del>");
  while (s.includes("\u0000")) s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[n]);
  return s;
}
