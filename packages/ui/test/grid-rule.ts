/**
 * The grid guard's checker (amendment 3, docs/design/grids/README.md#the-guard). Pure: it takes a
 * file's path and text and returns what breaks the rule. A collection takes `.canccu-grid`; a
 * layout whose columns are meant to be fixed carries the marker with its kind and reason, which
 * the reviewer checks against amendment 3's list of fixed layouts.
 */

export const KINDS = [
  "form",
  "table",
  "row",
  "master-detail",
  "control",
  "screen",
  "shell",
] as const;

export interface Finding {
  file: string;
  /** 1-based. */
  line: number;
  /** The declaration (or the marker) as found, whitespace folded. */
  text: string;
  message: string;
}

const UI_CSS = "packages/ui/ui.css";
const HINT =
  "a collection takes `.canccu-grid`; a fixed layout takes the marker with its kind and reason";
const SIZES = "a module never sets --canccu-grid-min: the three sizes are ui.css's";
const MARKER = /canccu-grid:\s*fixed\b(.*)$/;

/** The tracked files the guard reads, in the order given. */
export function guardedFiles(paths: readonly string[]): string[] {
  return paths.filter((p) => {
    if (p.includes("/node_modules/")) return false;
    if (p.endsWith(".css")) return p.startsWith("modules/") || p.startsWith("packages/ui/");
    if (!/\.(ts|js|mjs)$/.test(p) || p.endsWith(".d.ts")) return false;
    if (/(^|\/)test\//.test(p) || /\.test\.[mc]?[tj]s$/.test(p)) return false;
    return p.startsWith("modules/") || p.startsWith("packages/");
  });
}

export function checkGrids(file: string, text: string): Finding[] {
  const raw = text.split("\n");
  const found = file.endsWith(".css") ? cssDeclarations(file, text) : scriptDeclarations(raw);
  const markers = markerLines(raw);
  const used = new Set<number>();
  const out: Finding[] = [];
  for (const d of found) {
    if (d.allowed) continue;
    if (d.sizes) {
      out.push({ file, line: d.line, text: d.text, message: SIZES });
      continue;
    }
    const at = [d.line, d.line - 1].find((n) => markers.has(n));
    if (at === undefined) out.push({ file, line: d.line, text: d.text, message: HINT });
    else used.add(at);
  }
  for (const [line, problem] of markers) {
    const marker = (raw[line - 1] ?? "").trim();
    if (!used.has(line))
      out.push({
        file,
        line,
        text: marker,
        message: "a marker on no declaration: it goes on the declaration's line or the line above",
      });
    else if (problem !== null) out.push({ file, line, text: marker, message: problem });
  }
  return out.sort((a, b) => a.line - b.line);
}

interface Declaration {
  line: number;
  text: string;
  /** `ui.css`'s own `.canccu-grid` rule. */
  allowed: boolean;
  /** A `--canccu-grid-min` outside `ui.css`'s grid rules. */
  sizes: boolean;
}

/** Each marker's line, with what is wrong with it (null when it is well formed). */
function markerLines(raw: readonly string[]): Map<number, string | null> {
  const markers = new Map<number, string | null>();
  raw.forEach((l, i) => {
    const m = MARKER.exec(l);
    if (m === null) return;
    const rest = (m[1] ?? "").replace(/\*\/.*$/, "").trim();
    const parts = /^(\S+)(?:\s+[—-]\s+(.*))?$/.exec(rest);
    const kind = parts?.[1] ?? "";
    const reason = (parts?.[2] ?? "").trim();
    markers.set(
      i + 1,
      !(KINDS as readonly string[]).includes(kind)
        ? `unknown kind "${kind}": one of ${KINDS.join(", ")}`
        : reason.split(/\s+/).filter((w) => w !== "").length < 3
          ? "a marker needs a reason of at least three words after its kind"
          : null,
    );
  });
  return markers;
}

/** Comments become spaces, so line numbers stay and a commented-out declaration is not read. */
function blankComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
}

function cssDeclarations(file: string, text: string): Declaration[] {
  const code = blankComments(text);
  const out: Declaration[] = [];
  const preludes: string[] = [];
  let buf = "";
  let start = 1;
  let line = 1;
  const flush = () => {
    const d = declaration(file, buf, start, preludes.at(-1) ?? "");
    if (d !== null) out.push(d);
    buf = "";
  };
  for (const ch of code) {
    if (ch === "{") {
      preludes.push(buf.trim());
      buf = "";
    } else if (ch === "}") {
      flush();
      preludes.pop();
    } else if (ch === ";") flush();
    else {
      if (buf.trim() === "" && !/\s/.test(ch)) start = line;
      buf += ch;
    }
    if (ch === "\n") line += 1;
  }
  return out;
}

function declaration(file: string, buf: string, line: number, prelude: string): Declaration | null {
  const colon = buf.indexOf(":");
  if (colon < 0) return null;
  const prop = buf.slice(0, colon).trim();
  const value = buf
    .slice(colon + 1)
    .replace(/\s+/g, " ")
    .trim();
  const selectors = prelude.split(",").map((s) => s.trim());
  const ownRule = file === UI_CSS && selectors.includes(".canccu-grid");
  if (prop === "--canccu-grid-min") {
    const sizes = file === UI_CSS && selectors.some((s) => /^\.canccu-grid(--[a-z]+)?$/.test(s));
    return sizes ? null : { line, text: `${prop}: ${value}`, allowed: false, sizes: true };
  }
  if (prop === "grid-template-columns") {
    return { line, text: `${prop}: ${value}`, allowed: ownRule, sizes: false };
  }
  if (prop === "grid-template") {
    const slash = value.indexOf("/");
    if (slash < 0) return null;
    return {
      line,
      text: `${prop}: / ${value.slice(slash + 1).trim()}`,
      allowed: false,
      sizes: false,
    };
  }
  return null;
}

function scriptDeclarations(raw: readonly string[]): Declaration[] {
  const out: Declaration[] = [];
  raw.forEach((l, i) => {
    const trimmed = l.trim();
    if (trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("//")) return;
    const code = l.replace(/\s\/\/.*$/, "");
    const columns =
      /\bgridTemplateColumns\s*[=:]/.test(code) ||
      /setProperty\(\s*["'`]grid-template-columns["'`]/.test(code);
    const sizes = /["'`]--canccu-grid-min["'`]/.test(code);
    if (columns || sizes) {
      out.push({
        line: i + 1,
        text: trimmed.replace(/\s+/g, " "),
        allowed: false,
        sizes: sizes && !columns,
      });
    }
  });
  return out;
}
