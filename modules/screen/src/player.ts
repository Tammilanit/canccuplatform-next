/**
 * The kiosk's page (docs/plans/issue-109.md, S4): `/screen/` is a tiny loader that names one bundle
 * version, and `/screen/b/<version>/` serves that version's files under immutable addresses, so a
 * kiosk that runs for days never mixes the files of two releases. The version is the event's
 * pinned one while the bundle store keeps it, else the platform's own. The same loader, with another
 * `data-page`, serves a zone's virtual screen (`/screen/zones/<zone_key>`) and the kiosk check
 * (`/screen/check`); `/screen/sw.js` is the service worker that keeps the kiosk going offline (S9).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eventPageCsp, newNonce, normalizeHost } from "@canccu/kit";
import { allowedOrigins, YOUTUBE_ORIGIN } from "./assets/links.js";
import type { Db } from "./db.js";
import type { Settings } from "./health.js";
import { notFound } from "./http.js";
import { BUNDLE_FILES } from "./pins/bundles.js";
import type { BundleStore } from "./pins/bundles.js";
import { readPin } from "./pins/store.js";
import { ZONE_KEY_RE } from "./zone-input.js";

/** Where `npm run build` puts the bundle: next to this file in dist/. */
export const PLAYER_DIR = fileURLToPath(new URL("./player/", import.meta.url));

export interface PlayerDeps {
  db: Db;
  bundles: BundleStore;
  playerDir?: string;
  settings: Settings;
}

/**
 * The screen page's one widening of the event page CSP (contracts/screen.md, CSP): web assets'
 * origins and YouTube in `frame-src`. Only parsed https origins go in, so no list entry can end
 * the directive or add one of its own.
 */
function withFrames(csp: string, allowlist: unknown): string {
  const extra = [YOUTUBE_ORIGIN, ...allowedOrigins(allowlist)].join(" ");
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
  const dir = deps.playerDir ?? PLAYER_DIR;
  // The worker is this container's, whatever bundle a page loads: one worker per origin.
  let worker: Promise<Buffer> | undefined;
  const readWorker = async (): Promise<Buffer> => {
    worker ??= readFile(join(dir, "sw.js"));
    try {
      return await worker;
    } catch (err) {
      worker = undefined;
      // Not built (a dev server without the player build): a missing file, not a server fault.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw notFound();
      throw err;
    }
  };
  /** The event's pinned bundle while the store keeps it, else the platform's. */
  const versionFor = async (): Promise<string> => {
    const pinned = (await deps.db.tenant(readPin)).bundle_version;
    if (pinned !== null && (await deps.bundles.available()).includes(pinned)) return pinned;
    return deps.bundles.current;
  };

  app.get("/screen", async (request, reply) => {
    const query = request.url.slice("/screen".length);
    return reply.redirect(`/screen/${query}`, 308);
  });

  const sendPage = async (request: FastifyRequest, reply: FastifyReply, html: string) => {
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
      .send(html);
  };

  app.get("/screen/", async (request, reply) =>
    sendPage(request, reply, loaderHtml(await versionFor(), { page: "kiosk" })),
  );
  app.get("/screen/check", async (request, reply) =>
    sendPage(request, reply, loaderHtml(await versionFor(), { page: "check" })),
  );
  // The page asks for the zone itself, with the person's session: an unknown key or a missing
  // right is the API's answer there, so this page holds nothing but the key.
  app.get<{ Params: { zone_key: string } }>("/screen/zones/:zone_key", async (request, reply) => {
    const zone = request.params.zone_key;
    if (!ZONE_KEY_RE.test(zone)) throw notFound();
    return sendPage(request, reply, loaderHtml(await versionFor(), { page: "zone", zone }));
  });

  // At a fixed address the browser checks for updates on each load; the page registers it with
  // its bundle version (`?v=`), so a new release installs a new worker. Never cached for long:
  // browsers cap a worker's HTTP caching at a day, and a day-old worker would hold the old bundle.
  app.get("/screen/sw.js", async (_request, reply) =>
    reply
      .header("content-type", "text/javascript; charset=utf-8")
      .header("cache-control", "no-cache")
      .header("x-content-type-options", "nosniff")
      .send(await readWorker()),
  );

  app.get<{ Params: { version: string; file: string } }>(
    "/screen/b/:version/:file",
    async (request, reply) => {
      const { version, file } = request.params;
      const type = BUNDLE_FILES.get(file);
      if (type === undefined) throw notFound();
      const body = await deps.bundles.read(version, file);
      return reply
        .header("content-type", type)
        .header("cache-control", "public, max-age=31536000, immutable")
        .header("x-content-type-options", "nosniff")
        .send(body);
    },
  );
}
