/**
 * The kiosk's page (docs/plans/issue-109.md, S4): `/screen/` is a tiny loader that names one bundle
 * version, and `/screen/b/<version>/` serves that version's files under immutable addresses, so a
 * kiosk that runs for days never mixes the files of two releases. Until pins exist (#265) the
 * version is the platform's own, the only one a container holds. The same loader, with another
 * `data-page`, serves a zone's virtual screen (`/screen/zones/<zone_key>`) and the kiosk check
 * (`/screen/check`); `/screen/sw.js` is the service worker that keeps the kiosk going offline (S9).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eventPageCsp, newNonce, normalizeHost } from "@canccu/kit";
import { notFound } from "./http.js";
import { ZONE_KEY_RE } from "./zone-input.js";

/** Where `npm run build` puts the bundle: next to this file in dist/. */
export const PLAYER_DIR = fileURLToPath(new URL("./player/", import.meta.url));

const FILES = new Map([
  ["player.js", "text/javascript; charset=utf-8"],
  ["player.css", "text/css; charset=utf-8"],
]);

export interface PlayerDeps {
  bundleVersion: string;
  playerDir?: string;
}

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

/** Which page the bundle draws: the kiosk, a zone's virtual screen or the kiosk check. */
type Page = { page: "kiosk" } | { page: "zone"; zone: string } | { page: "check" };

function pageAttrs(page: Page): string {
  if (page.page === "kiosk") return "";
  const zone = page.page === "zone" ? ` data-zone="${escapeHtml(page.zone)}"` : "";
  return ` data-page="${page.page}"${zone}`;
}

function loaderHtml(version: string, page: Page): string {
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
    `<body class="canccu-page canccu-surface canccu-surface--screen" data-bundle="${safe}"${pageAttrs(page)}></body>`,
    "</html>",
    "",
  ].join("\n");
}

export function playerRoutes(app: FastifyInstance, deps: PlayerDeps): void {
  const version = deps.bundleVersion;
  const dir = deps.playerDir ?? PLAYER_DIR;
  const kiosk = loaderHtml(version, { page: "kiosk" });
  const check = loaderHtml(version, { page: "check" });
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

  const sendPage = (request: FastifyRequest, reply: FastifyReply, html: string) => {
    const hostname = normalizeHost(request.hostname) ?? "";
    // The sandbox on the address the page loaded from, so the IP-mode stack (plain http) frames
    // embeds too; the kit's default names https.
    const sandbox = `${request.protocol}://${request.host.toLowerCase()}/theming/sandbox/`;
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", eventPageCsp(newNonce(), hostname, { sandbox }))
      .send(html);
  };

  app.get("/screen/", (request, reply) => sendPage(request, reply, kiosk));
  app.get("/screen/check", (request, reply) => sendPage(request, reply, check));
  // The page asks for the zone itself, with the person's session: an unknown key or a missing
  // right is the API's answer there, so this page holds nothing but the key.
  app.get<{ Params: { zone_key: string } }>("/screen/zones/:zone_key", (request, reply) => {
    const zone = request.params.zone_key;
    if (!ZONE_KEY_RE.test(zone)) throw notFound();
    return sendPage(request, reply, loaderHtml(version, { page: "zone", zone }));
  });

  // At a fixed address the browser checks for updates on each load; the page registers it with
  // its bundle version (`?v=`), so a new release installs a new worker. Never cached for long:
  // browsers cap a worker's HTTP caching at a day, and a day-old worker would hold the old bundle.
  app.get("/screen/sw.js", async (_request, reply) =>
    reply
      .header("content-type", "text/javascript; charset=utf-8")
      .header("cache-control", "no-cache")
      .header("x-content-type-options", "nosniff")
      .send(await read("sw.js")),
  );

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
