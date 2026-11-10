/** The same-host sandbox: embeds under /theming/sandbox/ (contracts/theming.md, The sandbox). */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "./db.js";
import { findEmbedFile } from "./embeds.js";
import type { EmbedFile } from "./embeds.js";
import { EMBED_TYPES } from "./files.js";
import type { EmbedExt, FileStore } from "./files.js";

export const SANDBOX = "/theming/sandbox/";

/** For what the sandbox refuses: still an opaque origin, and nothing it may load. */
const REFUSED_POLICY = "default-src 'none'; sandbox";
const IMMUTABLE = "public, max-age=31536000, immutable";

const REVISION = /^[1-9][0-9]{0,9}$/;
const DRAFT_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const EMBED = /^[a-z][a-z0-9_-]{0,31}$/;
const PATH = /^[A-Za-z0-9._-]{1,129}(\/[A-Za-z0-9._-]{1,129}){0,15}$/;
// A host that resolved to an event is a hostname or an IP; anything else must not reach a header.
const HOST = /^[A-Za-z0-9.-]+(:[0-9]{1,5})?$|^\[[0-9A-Fa-f:.]+\](:[0-9]{1,5})?$/;

export interface SandboxDeps {
  db: Db;
  files: FileStore;
  /** The IP-mode demo stack: plain http, where browsers send no fetch metadata to an IP. */
  ipMode: boolean;
}

/** The embed's own CSP: its folder is the only place it loads from, and it connects nowhere. */
function embedPolicy(origin: string, base: string): string {
  const own = origin + base;
  return (
    `default-src 'none'; script-src ${own}; style-src ${own} 'unsafe-inline'; ` +
    `img-src ${own} data:; font-src ${own}; media-src ${own}; connect-src 'none'; ` +
    `form-action 'none'; base-uri 'none'; frame-ancestors ${origin}; sandbox allow-scripts`
  );
}

function decodedPath(url: string): string {
  const raw = url.split("?")[0] ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Only the sandbox loads sandbox files: the entry goes only to a frame, every other file only to
 * the opaque origin's own requests, which are cross-site. So no page on an event's hostname can run
 * an embed's JS as its own script or worker, although its CSP allows 'self'.
 */
function fetchedBySandbox(request: FastifyRequest, found: EmbedFile): boolean {
  const dest = request.headers["sec-fetch-dest"];
  const site = request.headers["sec-fetch-site"];
  return found.entry ? dest === "iframe" || dest === "frame" : site === "cross-site";
}

function refuse(reply: FastifyReply): FastifyReply {
  return reply.code(404).send();
}

/**
 * Every response under the path, the kit's errors included, keeps an opaque origin, sets no cookie
 * and paints nothing when it fails: a failed embed shows the still behind its frame.
 */
export function sandboxGuard(app: FastifyInstance): void {
  app.addHook("onSend", (request, reply, payload, done) => {
    if (!decodedPath(request.url).startsWith(SANDBOX)) {
      done(null, payload);
      return;
    }
    reply.removeHeader("set-cookie");
    if (reply.statusCode >= 400) {
      void reply
        .removeHeader("content-type")
        .header("content-security-policy", REFUSED_POLICY)
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff");
      done(null, "");
      return;
    }
    done(null, payload);
  });
}

export function sandboxRoutes(app: FastifyInstance, deps: SandboxDeps): void {
  async function serve(
    request: FastifyRequest,
    reply: FastifyReply,
    owner: { revision: string } | { draftKey: string },
    embed: string,
    path: string,
  ): Promise<FastifyReply> {
    const host = request.host;
    if (!EMBED.test(embed) || !PATH.test(path) || !HOST.test(host)) return refuse(reply);
    const found = await deps.db.tenant(async (c) => {
      if ("draftKey" in owner) {
        const { rows } = await c.query(`SELECT 1 FROM theming_drafts WHERE draft_key = $1`, [
          owner.draftKey,
        ]);
        if (rows.length === 0) return undefined;
      }
      const name = "draftKey" in owner ? "draft" : `r:${owner.revision}`;
      return findEmbedFile(c, name, embed, path);
    });
    if (found === undefined) return refuse(reply);
    if (!deps.ipMode && !fetchedBySandbox(request, found)) return refuse(reply);
    const bytes = await deps.files.read(found.file);
    if (bytes === undefined) return refuse(reply);

    const base =
      "draftKey" in owner
        ? `${SANDBOX}draft/${owner.draftKey}/${embed}/`
        : `${SANDBOX}${owner.revision}/${embed}/`;
    const ext = found.file.slice(found.file.lastIndexOf(".") + 1) as EmbedExt;
    return (
      reply
        .header("content-type", EMBED_TYPES[ext])
        .header("content-security-policy", embedPolicy(`${request.protocol}://${host}`, base))
        .header("x-content-type-options", "nosniff")
        // An opaque origin's requests for the embed's own files are cross-origin; the files are
        // public anyway, so any origin may read them, never with credentials.
        .header("cross-origin-resource-policy", "cross-origin")
        .header("access-control-allow-origin", "*")
        .header("cache-control", "draftKey" in owner ? "no-store" : IMMUTABLE)
        .header("vary", "Sec-Fetch-Dest, Sec-Fetch-Site")
        .send(bytes)
    );
  }

  app.get<{ Params: { revision: string; embed: string; "*": string } }>(
    `${SANDBOX}:revision/:embed/*`,
    async (request, reply) => {
      const { revision, embed } = request.params;
      if (!REVISION.test(revision)) return refuse(reply);
      return serve(request, reply, { revision }, embed, request.params["*"]);
    },
  );

  app.get<{ Params: { key: string; embed: string; "*": string } }>(
    `${SANDBOX}draft/:key/:embed/*`,
    async (request, reply) => {
      const { key, embed } = request.params;
      if (!DRAFT_KEY.test(key)) return refuse(reply);
      return serve(request, reply, { draftKey: key }, embed, request.params["*"]);
    },
  );
}
