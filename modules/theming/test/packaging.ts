/** Package zips of the demo themes and the requests of the package tests. */
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { LightMyRequestResponse } from "fastify";
import { VENUE_IP } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { packageZip } from "./zips.js";

const THEMES = new URL("../../../events/demo/themes/", import.meta.url).pathname;

/** A demo theme's files by package path, so a test can change one before zipping. */
export async function demoFiles(theme: string): Promise<Record<string, Buffer>> {
  const root = join(THEMES, theme);
  const out: Record<string, Buffer> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath, entry.name);
    out[relative(root, full)] = await readFile(full);
  }
  return out;
}

export const demoZip = async (theme: string): Promise<Buffer> => packageZip(await demoFiles(theme));

export function putPackage(
  h: Harness,
  zip: Buffer,
  opts: { version?: number; session?: string; host?: string } = {},
): Promise<LightMyRequestResponse> {
  const query = opts.version === undefined ? "" : `?draft_version=${opts.version}`;
  return h.app.inject({
    method: "PUT",
    url: `/api/theming/draft/package${query}`,
    headers: {
      host: opts.host ?? "alpha.test",
      "x-forwarded-for": VENUE_IP,
      cookie: `canccu_session=${opts.session ?? "admin"}`,
      "content-type": "application/zip",
    },
    payload: zip,
  });
}
