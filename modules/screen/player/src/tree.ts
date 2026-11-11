/**
 * Draws a parsed template (contracts/theming.md, The parsed tree) with createElement and
 * textContent only: template text and data are never joined into a string and parsed as HTML, so
 * data can never become markup. A node or attribute the renderer does not know is skipped, so a
 * newer theme's tree still draws on an older player.
 */

export type TreeNode =
  | { text: string }
  | { field: string }
  | { section: string; inverted: boolean; children: TreeNode[] }
  | { element: string; attrs: Record<string, TreeNode[]>; children: TreeNode[] };

// theming.md, Widget templates: the only elements and attributes a template may hold.
const ELEMENTS = new Set([
  "div", "span", "p", "h1", "h2", "h3", "h4", "ul", "ol", "li", "strong", "em", "b", "i",
  "small", "br", "img", "figure", "figcaption", "time", "table", "thead", "tbody", "tr", "th", "td",
]); // prettier-ignore
const ATTRS = new Set([
  "class", "alt", "aria-label", "aria-hidden", "datetime", "colspan", "rowspan", "src",
]); // prettier-ignore
const VOID = new Set(["br", "img"]);
const MAX_DEPTH = 8;
// The page's CSP lets images load from its own host and `data:` only; anything else is left out
// rather than left to the browser to refuse, so a theme can never make a screen fetch elsewhere.
// Browsers read `/\host` as `//host`, so a backslash after the slash is refused too.
const IMAGE_SRC = /^(\/(?![/\\])|data:image\/(png|jpeg|webp|gif|svg\+xml)[;,])/;

type Scope = readonly unknown[];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Mustache's lookup: the first scope, innermost first, whose object has the first segment. */
function lookup(name: string, scopes: Scope): unknown {
  const [head, ...rest] = name.split(".");
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (isObject(scope) && head !== undefined && head in scope) {
      return rest.reduce<unknown>((v, key) => (isObject(v) ? v[key] : undefined), scope[head]);
    }
  }
  return undefined;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  return "";
}

/** What a section repeats over: one scope per showing, none when it shows nothing. */
function showings(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isObject(value) || value === true) return [value];
  if ((typeof value === "string" || typeof value === "number") && value !== "") return [value];
  return [];
}

function attrText(nodes: TreeNode[], scopes: Scope, inClass: boolean, depth: number): string {
  let out = "";
  for (const node of nodes) {
    if (!isObject(node)) continue;
    if ("text" in node && typeof node.text === "string") out += node.text;
    else if ("field" in node && typeof node.field === "string") {
      const value = asText(lookup(node.field, scopes));
      // Data may lengthen a class name, never add one of its own.
      out += inClass ? value.replace(/[^a-z0-9-]/g, "") : value;
    } else if ("section" in node && Array.isArray(node.children) && depth < MAX_DEPTH) {
      for (const scope of sectionScopes(node, scopes)) {
        out += attrText(node.children, scope, inClass, depth + 1);
      }
    }
  }
  return out;
}

function sectionScopes(
  node: { section: string; inverted: boolean; children: TreeNode[] },
  scopes: Scope,
): Scope[] {
  const items = showings(lookup(node.section, scopes));
  if (node.inverted) return items.length === 0 ? [scopes] : [];
  return items.map((item) => [...scopes, item]);
}

function build(nodes: TreeNode[], scopes: Scope, depth: number): Node[] {
  const out: Node[] = [];
  for (const node of nodes) {
    if ("text" in node && typeof node.text === "string") {
      out.push(document.createTextNode(node.text));
    } else if ("field" in node && typeof node.field === "string") {
      out.push(document.createTextNode(asText(lookup(node.field, scopes))));
    } else if ("section" in node && Array.isArray(node.children)) {
      if (depth >= MAX_DEPTH) continue;
      for (const scope of sectionScopes(node, scopes)) {
        out.push(...build(node.children, scope, depth + 1));
      }
    } else if ("element" in node && ELEMENTS.has(node.element)) {
      out.push(element(node, scopes, depth));
    }
  }
  return out;
}

function element(
  node: { element: string; attrs: Record<string, TreeNode[]>; children: TreeNode[] },
  scopes: Scope,
  depth: number,
): HTMLElement {
  const el = document.createElement(node.element);
  for (const [name, value] of Object.entries(isObject(node.attrs) ? node.attrs : {})) {
    if (!ATTRS.has(name) || !Array.isArray(value)) continue;
    if (name === "src" && node.element !== "img") continue;
    const text = attrText(value, scopes, name === "class", depth).trim();
    if (name === "src" && !IMAGE_SRC.test(text)) continue;
    el.setAttribute(name, text);
  }
  if (!VOID.has(node.element) && Array.isArray(node.children)) {
    el.append(...build(node.children, scopes, depth));
  }
  return el;
}

/** The nodes of a template drawn for one view-model. */
export function renderTree(nodes: readonly TreeNode[], view: unknown): Node[] {
  return Array.isArray(nodes) ? build(nodes as TreeNode[], [view], 0) : [];
}
