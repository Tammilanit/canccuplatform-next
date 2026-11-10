/**
 * The SVG rules (contracts/theming.md, SVG): an SVG passes only when it can load and run nothing.
 * It is served with a sandboxing CSP and used only through `<img>` and CSS, where browsers run no
 * script; these rules are the layer beneath, so a file that would misbehave anywhere never gets in.
 */
import { SaxesParser } from "saxes";
import type { SaxesTagNS } from "saxes";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Elements that run script, embed other documents or play media. Compared by local name in any
 * namespace and any case, so `<h:script xmlns:h="…xhtml">` or `<SCRIPT>` are no way round.
 * `handler` is SVG Tiny 1.2's script element, which no browser runs today.
 */
const FORBIDDEN_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "embed",
  "object",
  "audio",
  "video",
  "handler",
]);

/** An entity reference other than XML's five and character references. */
const ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/;
/** A same-document reference: the only kind an SVG may make. */
const LOCAL_REF = /^#[A-Za-z_][A-Za-z0-9_.:-]*$/;

export type SvgVerdict =
  { ok: true } | { ok: false; code: "svg_forbidden" | "file_type"; why: string };

/** CSS escapes (`\72`, `\r`) undone, so `u\72l(` is checked as the `url(` a browser reads. */
function unescapeCss(text: string): string {
  return text
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (_m, hex: string) =>
      String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd),
    )
    .replace(/\\(.)/gs, "$1");
}

/** Why `text` (a style sheet or an attribute value) could load something, or undefined. */
function cssReason(text: string): string | undefined {
  const css = unescapeCss(text).toLowerCase();
  if (css.includes("@import")) return "@import";
  if (css.includes("data:")) return "a data: URL";
  // Functions that take an address other than through url().
  if (/(?:^|[^a-z0-9_-])(?:-webkit-)?image(?:-set)?\(|(?:^|[^a-z0-9_-])src\(/.test(css)) {
    return "an image() or src() address";
  }
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)?/g)) {
    const target = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!LOCAL_REF.test(target)) return "url() naming something outside the file";
  }
  return undefined;
}

function attributeReason(tag: SaxesTagNS): string | undefined {
  const element = tag.local.toLowerCase();
  for (const attr of Object.values(tag.attributes)) {
    const local = attr.local.toLowerCase();
    if (local.startsWith("on")) return `the event handler ${attr.name}`;
    if (local === "href" && !LOCAL_REF.test(attr.value.trim())) {
      return `${attr.name} naming something outside the file`;
    }
    // Animating an address or a handler would set what the two rules above refuse.
    if ((element.startsWith("animate") || element === "set") && local === "attributename") {
      const target = attr.value.trim().toLowerCase().split(":").pop() ?? "";
      if (target === "href" || target.startsWith("on")) return `${element} on ${attr.value}`;
    }
    const css = cssReason(attr.value);
    if (css !== undefined) return css;
  }
  return undefined;
}

/** Checks an SVG's text; the caller has decoded it as UTF-8 and sniffed it as SVG. */
export function checkSvg(text: string): SvgVerdict {
  // Refused before parsing, so no parser ever expands an entity (entity and alias bombs).
  if (/<!DOCTYPE/i.test(text)) return { ok: false, code: "svg_forbidden", why: "a DOCTYPE" };
  if (/<!ENTITY/i.test(text) || ENTITY.test(text)) {
    return { ok: false, code: "svg_forbidden", why: "an entity" };
  }
  let forbidden: string | undefined;
  let malformed: string | undefined;
  let root: SaxesTagNS | undefined;
  const open: string[] = [];
  let style = "";
  const parser = new SaxesParser({ xmlns: true });
  parser.on("error", (err) => {
    malformed ??= err.message;
  });
  parser.on("processinginstruction", (pi) => {
    forbidden ??= `the processing instruction ${pi.target}`;
  });
  parser.on("doctype", () => {
    forbidden ??= "a DOCTYPE";
  });
  parser.on("opentag", (tag) => {
    root ??= tag;
    const name = tag.local.toLowerCase();
    open.push(name);
    if (FORBIDDEN_ELEMENTS.has(name)) forbidden ??= `the element ${tag.name}`;
    forbidden ??= attributeReason(tag);
  });
  parser.on("closetag", () => {
    open.pop();
  });
  const styleText = (text: string): void => {
    if (open.at(-1) === "style") style += text;
  };
  parser.on("text", styleText);
  parser.on("cdata", styleText);
  try {
    parser.write(text).close();
  } catch (err) {
    malformed ??= String(err);
  }
  forbidden ??= cssReason(style);
  if (forbidden !== undefined) return { ok: false, code: "svg_forbidden", why: forbidden };
  if (malformed !== undefined)
    return { ok: false, code: "file_type", why: "it is not well-formed XML" };
  if (root?.local !== "svg" || root.uri !== SVG_NS) {
    return {
      ok: false,
      code: "file_type",
      why: "its root is not an svg element in the SVG namespace",
    };
  }
  return { ok: true };
}
