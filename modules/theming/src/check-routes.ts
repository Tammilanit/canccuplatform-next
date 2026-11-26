/**
 * The Advanced page's own paths (plan issue-784 D15, D16; contracts/theming.md, Advanced mode):
 * `POST /api/theming/draft/check` runs one CSS file's or template's checks as the editor holds it,
 * storing nothing, and `PATCH /api/theming/draft/parts` puts what the page uploaded into
 * theme.yaml through the one draft write path, so every check runs on the result.
 */
import type { FastifyInstance } from "fastify";
import type { SqlClient } from "@canccu/kit";
import { KitError } from "@canccu/kit";
import { isObject } from "./checks.js";
import type { Manifest, Problem } from "./checks.js";
import { cssReasons } from "./css.js";
import type { DraftDeps } from "./draft-routes.js";
import { draftBody, editDraft, loadDraft } from "./drafts.js";
import { WRITE, actorOf, assertWritable, invalidRequest, needs, noDraft } from "./http.js";
import { draftPaths } from "./package-files.js";
import { readabilityProblems } from "./readability.js";
import { partsEditError } from "./schema.js";
import type { PartsEdit } from "./schema.js";
import { parseTemplate } from "./template.js";

/** A CSS file or a template as theme.schema.json names them. */
const EDITABLE =
  /^(css\/(?!.*\.\.)[A-Za-z0-9._/-]{1,120}\.css|templates\/(?!.*\.\.)[A-Za-z0-9._/-]{1,120}\.mustache)$/;
/** Over a file's own limit is the check's own problem; this only bounds the request. */
const MAX_TEXT = 512 * 1024;

const missing = (path: string, ref: string, at: { line?: number; column?: number }): Problem => ({
  severity: "error",
  code: path.startsWith("css/") ? "css_forbidden" : "template_forbidden",
  path,
  message: `Refused: ${ref} is not in this theme. Add the file first, then name it here.`,
  ...at,
});

/**
 * The problems `path` would have with `text` in the draft: its own checks, each refused rule on
 * its own with its line, the package files it names that the draft does not hold, and, for CSS,
 * small text against the draft's other CSS.
 */
export async function checkFile(c: SqlClient, path: string, text: string): Promise<Problem[]> {
  const draft = await loadDraft(c);
  if (draft === undefined) throw noDraft();
  const bytes = Buffer.from(text, "utf8");
  const held = await draftPaths(c);
  const holds = (ref: string): boolean => held.present.has(ref) && !held.failed.has(ref);
  if (path.startsWith("css/")) {
    const checked = cssReasons(path, bytes);
    if (!checked.ok) return checked.reasons;
    const refs = [...checked.refsAt].filter(([ref]) => !holds(ref));
    const small = await readabilityProblems(c, draft.manifest, { path, sizes: checked.sizes });
    return [
      ...refs.map(([ref, at]) => missing(path, ref, at)),
      ...checked.warnings,
      ...small.filter((p) => p.path === path),
    ];
  }
  const parsed = parseTemplate(path, bytes);
  if (!parsed.ok) return [parsed.problem];
  return parsed.refs.filter((ref) => !holds(ref)).map((ref) => missing(path, ref, {}));
}

const brandMissing = (): KitError =>
  new KitError("The draft has no brand to put a picture in. Set one in Make it yours first.", {
    status: 409,
    code: "brand_missing",
  });

/** Each widget of `type` in the draft's layouts with `name` as its template, or none. */
function withLook(layouts: unknown, type: string, name: string | null): unknown {
  if (!Array.isArray(layouts)) return layouts;
  const widget = (w: unknown): unknown => {
    if (!isObject(w) || w.widget !== type) return w;
    const { template: _old, ...rest } = w;
    return name === null ? rest : { ...rest, template: name };
  };
  return layouts.map((l: unknown) =>
    isObject(l) && Array.isArray(l.regions)
      ? {
          ...l,
          regions: l.regions.map((r: unknown) =>
            isObject(r) && Array.isArray(r.widgets) ? { ...r, widgets: r.widgets.map(widget) } : r,
          ),
        }
      : l,
  );
}

/** A list of theme.yaml replaced whole; an empty one leaves theme.yaml without the key. */
function setList(m: Manifest, key: "css" | "fonts", value: unknown[] | undefined): void {
  if (value === undefined) return;
  if (value.length === 0) Reflect.deleteProperty(m, key);
  else m[key] = value;
}

/** The parts the Advanced page changes; CSS, fonts, templates and box looks make it advanced. */
export function applyParts(manifest: Manifest, edit: PartsEdit): Manifest {
  const m: Manifest = { ...manifest };
  setList(m, "css", edit.css);
  setList(m, "fonts", edit.fonts);
  if (edit.templates !== undefined) {
    const templates = { ...(isObject(m.templates) ? m.templates : {}) };
    for (const [name, t] of Object.entries(edit.templates)) {
      if (t === null) Reflect.deleteProperty(templates, name);
      else templates[name] = t;
    }
    if (Object.keys(templates).length === 0) Reflect.deleteProperty(m, "templates");
    else m.templates = templates;
  }
  for (const [type, name] of Object.entries(edit.looks ?? {})) {
    const t = name === null || !isObject(m.templates) ? undefined : m.templates[name];
    if (name !== null && (!isObject(t) || t.widget !== type)) {
      throw invalidRequest(`The theme has no look named ${name} made for this kind of box.`);
    }
    m.layouts = withLook(m.layouts, type, name);
  }
  if (edit.backdrop_image !== undefined) {
    if (!isObject(m.brand)) throw brandMissing();
    const { image: _old, ...backdrop } = isObject(m.brand.backdrop) ? m.brand.backdrop : {};
    const next =
      edit.backdrop_image === null ? backdrop : { ...backdrop, image: edit.backdrop_image };
    const { backdrop: _was, ...brand } = m.brand;
    m.brand = Object.keys(next).length === 0 ? brand : { ...brand, backdrop: next };
  }
  const styling = ["css", "fonts", "templates", "looks"].some(
    (k) => edit[k as keyof PartsEdit] !== undefined,
  );
  return styling ? { ...m, mode: "advanced" } : m;
}

export function checkRoutes(app: FastifyInstance, deps: DraftDeps): void {
  const writer = { preHandler: needs(deps.rights, WRITE) };

  app.post("/api/theming/draft/check", writer, async (request) => {
    const b = request.body;
    if (
      !isObject(b) ||
      Object.keys(b).some((k) => k !== "path" && k !== "text") ||
      typeof b.path !== "string" ||
      !EDITABLE.test(b.path) ||
      typeof b.text !== "string" ||
      b.text.length > MAX_TEXT
    ) {
      throw invalidRequest("path is a CSS file or a template of the package, and text its text.");
    }
    const { path, text } = b;
    return { problems: await deps.db.tenant((c) => checkFile(c, path, text)) };
  });

  app.patch("/api/theming/draft/parts", writer, async (request) => {
    assertWritable(request);
    const why = partsEditError(request.body);
    if (why !== undefined) throw invalidRequest(why);
    const edit = request.body as PartsEdit;
    const row = await deps.db.tenant((c) =>
      editDraft(c, deps.files, edit.draft_version, actorOf(request), (m) => applyParts(m, edit)),
    );
    return draftBody(row);
  });
}
