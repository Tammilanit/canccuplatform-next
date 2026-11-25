/**
 * A photo form's answer (#789 item 2, D11): a redirect, as every form here answers, or, for the
 * page's script (`Accept: application/x-ndjson`, static/progress.js), one JSON line per step the
 * server takes ("reading", "checking") as it takes it, then where to go, or what to post there. The steps are what the
 * server is doing, never timers; without a script the form posts and redirects as before.
 */
import type { FastifyReply, FastifyRequest } from "fastify";

export interface Steps {
  /** Whether the answer is the script's stream (then nothing may be thrown after it began). */
  readonly streamed: boolean;
  phase(p: { phase: "reading" | "checking"; pages?: number; seconds?: number }): void;
  go(url: string): FastifyReply;
  /**
   * The script's stream only: post these fields to `action`, a page that shows a result the server
   * keeps nowhere (a menu read's table, which travels in its form, D10).
   */
  post(action: string, fields: Record<string, string>): FastifyReply;
}

export function stepsFor(request: FastifyRequest, reply: FastifyReply): Steps {
  if (!(request.headers.accept ?? "").includes("application/x-ndjson"))
    return {
      streamed: false,
      phase: () => undefined,
      go: (url) => reply.redirect(url, 303),
      post: () => {
        throw new Error("post is for the script's stream");
      },
    };
  let started = false;
  const line = (o: Record<string, unknown>) => {
    if (!started) {
      started = true;
      // The answer is written by hand from here: Fastify's reply is done with.
      void reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
    }
    reply.raw.write(`${JSON.stringify(o)}\n`);
  };
  return {
    streamed: true,
    phase: line,
    go: (url) => {
      line({ location: url });
      reply.raw.end();
      return reply;
    },
    post: (action, fields) => {
      line({ post: { action, fields } });
      reply.raw.end();
      return reply;
    },
  };
}
