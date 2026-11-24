/**
 * A photo form's answer (#789 item 2, D11): a redirect, as every form here answers, or, for the
 * page's script (`Accept: application/x-ndjson`, static/progress.js), one JSON line per step the
 * server takes ("reading", "checking") as it takes it, then where to go. The steps are what the
 * server is doing, never timers; without a script the form posts and redirects as before.
 */
import type { FastifyReply, FastifyRequest } from "fastify";

export interface Steps {
  /** Whether the answer is the script's stream (then nothing may be thrown after it began). */
  readonly streamed: boolean;
  phase(p: { phase: "reading" | "checking"; seconds?: number }): void;
  go(url: string): FastifyReply;
}

export function stepsFor(request: FastifyRequest, reply: FastifyReply): Steps {
  if (!(request.headers.accept ?? "").includes("application/x-ndjson"))
    return { streamed: false, phase: () => undefined, go: (url) => reply.redirect(url, 303) };
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
  };
}
