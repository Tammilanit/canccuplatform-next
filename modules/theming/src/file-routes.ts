/**
 * One file of the draft: `PUT` and `DELETE /api/theming/draft/file?path=` (contracts/theming.md,
 * Draft, preview, publish). Every upload is checked before any lock is taken (uploads.ts), then
 * stored through the one draft write path with its bytes reserved (stored.ts).
 */
import type { FastifyInstance } from "fastify";
import { KitError } from "@canccu/kit";
import { requiredVersion } from "./draft-routes.js";
import type { DraftDeps } from "./draft-routes.js";
import { draftBody, editDraft } from "./drafts.js";
import { WRITE, actorOf, assertWritable, invalidRequest, needs, rawBody } from "./http.js";
import { removeDraftPath, setDraftPath } from "./package-files.js";
import type { PathEntry } from "./package-files.js";
import { MAX_PATH } from "./package.js";
import { writingFiles } from "./stored.js";
import { BODY_LIMIT, UPLOAD_FOLDERS, checkUpload } from "./uploads.js";

/** PackagePath of contracts/theming.openapi.yaml. */
const PACKAGE_PATH = /^(?!.*\.\.)(css|fonts|images|templates|embeds)\/[A-Za-z0-9._/-]{1,129}$/;

const tooLarge = (): KitError =>
  new KitError("A file is at most 5 MB.", { status: 413, code: "too_large" });

/** The path as the package rules take it: no empty, `.` or `..` part either. */
function uploadPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !PACKAGE_PATH.test(value) ||
    value.length > MAX_PATH ||
    value.split("/").some((part) => part === "" || part === ".")
  ) {
    throw invalidRequest("path must be a package path, such as images/logo.png.");
  }
  // Embeds and font licences come only with the whole package (package-routes.ts): an embed is
  // checked as a whole folder, a licence with the fonts it belongs to.
  const folder = value.slice(0, value.indexOf("/"));
  if (!UPLOAD_FOLDERS.includes(folder) || /\.(txt|md)$/i.test(value)) {
    throw invalidRequest(
      "Only CSS, templates, images and fonts can be uploaded one by one; embeds and licences come with the package.",
    );
  }
  return value;
}

interface FileQuery {
  Querystring: { path?: string; draft_version?: string };
}

export function fileRoutes(app: FastifyInstance, deps: DraftDeps): void {
  void app.register((scope, _opts, done) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", rawBody(BODY_LIMIT, tooLarge));
    const route = { preHandler: needs(deps.rights, WRITE) };

    scope.put<FileQuery>("/api/theming/draft/file", route, async (request) => {
      assertWritable(request);
      const version = requiredVersion(request.query.draft_version);
      const path = uploadPath(request.query.path);
      const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const checked = await checkUpload(path, body);
      const row = await writingFiles(deps, async (c, place) => {
        let unused: string[] = [];
        const draft = await editDraft(c, version, actorOf(request), async (manifest) => {
          const entry: PathEntry = checked.ok
            ? {
                file: await place(checked.bytes, checked.ext),
                bytes: checked.bytes.length,
                refs: checked.refs,
                warnings: checked.warnings,
              }
            : { problem: checked.problem };
          unused = await setDraftPath(c, path, entry);
          // Any file but an image is styling only the advanced mode makes (Advanced mode).
          return path.startsWith("images/") ? manifest : { ...manifest, mode: "advanced" };
        });
        return { result: draft, unused };
      });
      return draftBody(row);
    });

    scope.delete<FileQuery>("/api/theming/draft/file", route, async (request) => {
      assertWritable(request);
      const version = requiredVersion(request.query.draft_version);
      const path = uploadPath(request.query.path);
      const row = await writingFiles(deps, async (c) => {
        let unused: string[] = [];
        const draft = await editDraft(c, version, actorOf(request), async (manifest) => {
          unused = await removeDraftPath(c, path);
          return manifest;
        });
        return { result: draft, unused };
      });
      return draftBody(row);
    });
    done();
  });
}
