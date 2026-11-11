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
import { eventPageCsp, newNonce, normalizeHost } from "@canccu/kit";
import { allowedOrigins } from "./assets/links.js";
import type { Settings } from "./health.js";
import { notFound } from "./http.js";

/** Where `npm run build` puts the bundle: next to this file in dist/. */
export const PLAYER_DIR = fileURLToPath(new URL("./player/", import.meta.url));

const FILES = new Map([
  ["player.js", "text/javascript; charset=utf-8"],
  ["player.css", "text/css; charset=utf-8"],
]);

export interface PlayerDeps {
  bundleVersion: string;
  playerDir?: string;
  settings: Settings;
}

/** The one origin YouTube assets are framed from (src/assets/links.ts). */
const YOUTUBE = "https://www.youtube-nocookie.com";

/**
 * The screen page's one widening of the event page CSP (contracts/screen.md, CSP): web assets'
 * origins and YouTube in `frame-src`. Only parsed https origins go in, so no list entry can end
 * the directive or add one of its own.
 */
function withFrames(csp: string, allowlist: unknown): string {
  const extra = [YOUTUBE, ...allowedOrigins(allowlist)].join(" ");
  return csp.replace(/(^|; )frame-src ([^;]*)/, (_m, pre: string, src: string) => {
    return `${pre}frame-src ${src} ${extra}`;
  });
}

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

function loaderHtml(version: string): string {
  // Escaped, not refused: an odd CANCCU_VERSION then breaks no other route, and the page still loads.
  const safe = escapeHtml(version);
  const base = `/screen/b/${escapeHtml(encodeURIComponent(version))}`;
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
    `<body class="canccu-page canccu-surface canccu-surface--screen" data-bundle="${safe}"></body>`,
    "</html>",
    "",
  ].join("\n");
}

export function playerRoutes(app: FastifyInstance, deps: PlayerDeps): void {
  const version = deps.bundleVersion;
  const dir = deps.playerDir ?? PLAYER_DIR;
  const page = loaderHtml(version);
  // The files never change under one version: read once, on first use (a failed read is not kept).
  const bytes = new Map<string, Promise<Buffer>>();
  const read = (file: string): Promise<Buffer> => {
    let pending = bytes.get(file);
    if (pending === undefined) {
      pending = readFile(join(dir, file));
      pending.catch(() => bytes.delete(file));
      bytes.set(file, pending);
    }
    return pending;
  };

  app.get("/screen", async (request, reply) => {
    const query = request.url.slice("/screen".length);
    return reply.redirect(`/screen/${query}`, 308);
  });

  app.get("/screen/", async (request, reply) => {
    const hostname = normalizeHost(request.hostname) ?? "";
    // The sandbox on the address the page loaded from, so the IP-mode stack (plain http) frames
    // embeds too; the kit's default names https.
    const sandbox = `${request.protocol}://${request.host.toLowerCase()}/theming/sandbox/`;
    await deps.settings.ensure();
    const csp = withFrames(
      eventPageCsp(newNonce(), hostname, { sandbox }),
      deps.settings.get("web_allowlist", []),
    );
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", csp)
      .send(page);
  });

  app.get<{ Params: { version: string; file: string } }>(
    "/screen/b/:version/:file",
    async (request, reply) => {
      const { file } = request.params;
      const type = FILES.get(file);
      if (request.params.version !== version || type === undefined) throw notFound();
      const body = await read(file);
      return reply
        .header("content-type", type)
        .header("cache-control", "public, max-age=31536000, immutable")
        .header("x-content-type-options", "nosniff")
        .send(body);
    },
  );
}
