/**
 * What every organiser page must have (#782, docs/design/README.md decisions 8 and 9), as a test
 * helper the modules' page tests call on each page they draw: a description of at most two
 * sentences and 240 characters under the title, a tooltip on every status chip, and a label and a
 * tooltip on every icon-only button. The shell's own header and menu are the kit's, tested here;
 * the check reads the page's `<main>`. canccu_kit.page_check is its twin.
 */
const MAIN = /<main\b[\s\S]*?<\/main>/;
const DESC = /<p class="canccu-pagehead__desc">([\s\S]*?)<\/p>/;
const BADGE = /<span class="canccu-badge[^"]*"([^>]*)>([\s\S]*?)<\/span>/g;
const BUTTON = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g;
const TIP_OPEN = '<span class="canccu-tip">';
const MAX_DESCRIPTION = 240;

// Python's html.unescape knows every HTML5 name; the twin decodes every number and the names the
// platform's markup writes, and leaves any other as written.
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  minus: "\u2212",
  ndash: "\u2013",
  mdash: "\u2014",
  middot: "\u00b7",
  hellip: "\u2026",
};
const decode = (m: string, e: string): string => {
  const n = /^#x([0-9a-f]+)$/i.exec(e)?.[1] ?? /^#(\d+)$/.exec(e)?.[1];
  if (n === undefined) return ENTITIES[e] ?? m;
  const code = Number.parseInt(n, e[1]?.toLowerCase() === "x" ? 16 : 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
};
// A status chip in a description: its tooltip is shown on demand, not read as the description.
const TIP_TEXT = /<span\b[^>]*class="canccu-tip__text"[^>]*>[\s\S]*?<\/span>/g;
const text = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, "")
    .replace(/&(#?\w+);/g, decode)
    .trim();

/** Each missing description, untipped chip or unlabelled icon button, in words. */
export function pageProblems(doc: string): string[] {
  const main = MAIN.exec(doc)?.[0] ?? doc;
  const problems: string[] = [];
  if (main.includes('class="canccu-pagehead"')) {
    const desc = text((DESC.exec(main)?.[1] ?? "").replace(TIP_TEXT, ""));
    if (desc === "") problems.push("no page description");
    else if (desc.length > MAX_DESCRIPTION || (desc.match(/[.!?](?=\s|$)/g) ?? []).length > 2)
      problems.push(`page description longer than two sentences: ${desc}`);
  }
  for (const chip of main.matchAll(BADGE)) {
    if (!(chip[1] ?? "").includes("aria-describedby="))
      problems.push(`status chip without a tooltip: ${text(chip[2] ?? "")}`);
  }
  for (const b of main.matchAll(BUTTON)) {
    const [whole, tag, attrs = "", inner = ""] = b;
    if (tag === "a" && !attrs.includes("canccu-button")) continue;
    if (text(inner).length > 1) continue;
    const label = /aria-label="([^"]*)"/.exec(attrs)?.[1];
    if (label === undefined)
      problems.push(`icon-only button without a label: ${whole.slice(0, 80)}`);
    else if (!main.slice(0, b.index).endsWith(TIP_OPEN))
      problems.push(`icon-only button without a tooltip: ${label}`);
  }
  return problems;
}
