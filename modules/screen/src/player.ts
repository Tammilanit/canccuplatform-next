/**
 * The kiosk's page (docs/plans/issue-109.md, S4): `/screen/` is a tiny loader that names one bundle
 * version, and `/screen/b/<version>/` serves that version's files under immutable addresses, so a
 * kiosk that runs for days never mixes the files of two releases. Until pins exist (#265) the
 * version is the platform's own, the only one a container holds.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { eventPageCsp, newNonce } from "@canccu/kit";
import { notFound } from "./http.js";

/** Where `npm run build` puts the bundle: next to this file in dist/. */
export const PLAYER_DIR = fileURLToPath(new URL("./player/", import.meta.url));

const FILES = new Map([
  ["player.js", "text/javascript; charset=utf-8"],
  ["player.css", "text/css; charset=utf-8"],
]);

// The version goes into the page's URLs and attributes unescaped: only these characters are safe.
const VERSION_RE = /^[A-Za-z0-9._+-]{1,64}$/;

export interface PlayerDeps {
  bundleVersion: string;
  playerDir?: string;
}

function loaderHtml(version: string): string {
  const base = `/screen/b/${version}`;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    "<title>Screen</title>",
    `<link rel="stylesheet" href="${base}/player.css">`,
    `<script type="module" src="${base}/player.js"></script>`,
    "</head>",
    `<body class="canccu-page canccu-surface canccu-surface--screen" data-bundle="${version}"></body>`,
    "</html>",
    "",
  ].join("\n");
}

export function playerRoutes(app: FastifyInstance, deps: PlayerDeps): void {
  const version = deps.bundleVersion;
  if (!VERSION_RE.test(version)) throw new RangeError(`invalid bundle version ${version}`);
  const dir = deps.playerDir ?? PLAYER_DIR;
  const page = loaderHtml(version);

  app.get("/screen", async (request, reply) => {
    const query = request.url.slice("/screen".length);
    return reply.redirect(`/screen/${query}`, 308);
  });

  app.get("/screen/", async (request, reply) => {
    const hostname = request.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
    // The sandbox on the address the page loaded from, so the IP-mode stack (plain http) frames
    // embeds too; the kit's default names https.
    const sandbox = `${request.protocol}://${request.host.toLowerCase()}/theming/sandbox/`;
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", eventPageCsp(newNonce(), hostname, { sandbox }))
      .send(page);
  });

  app.get<{ Params: { version: string; file: string } }>(
    "/screen/b/:version/:file",
    async (request, reply) => {
      const { file } = request.params;
      const type = FILES.get(file);
      if (request.params.version !== version || type === undefined) throw notFound();
      const bytes = await readFile(join(dir, file));
      return reply
        .header("content-type", type)
        .header("cache-control", "public, max-age=31536000, immutable")
        .header("x-content-type-options", "nosniff")
        .send(bytes);
    },
  );
}
