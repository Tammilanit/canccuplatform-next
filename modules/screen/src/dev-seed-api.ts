/**
 * How the dev seed (dev-seed.ts) reaches Screen: requests injected into a Screen app in its own
 * process, on the demo event's hostname, so every write takes the routes' own checks, files,
 * quota, audit and events, as an organiser's would. No port is opened.
 */
import type { FastifyInstance, LightMyRequestResponse } from "fastify";

export interface Answer {
  status: number;
  // The routes' JSON, read by the seed field by field.
  body: Record<string, unknown>;
}

export interface SeedApi {
  json(method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: unknown): Promise<Answer>;
  /** One file as multipart, with text fields, as Studio uploads it. */
  upload(
    url: string,
    file: Buffer,
    filename: string,
    fields: Record<string, string>,
  ): Promise<Answer>;
}

const BOUNDARY = "canccu-dev-seed";

function answer(res: LightMyRequestResponse): Answer {
  const text = res.body;
  return { status: res.statusCode, body: text === "" ? {} : (JSON.parse(text) as Answer["body"]) };
}

/** `ip` must pass admin pages' address rule (the venue or Tailscale). */
export function injectApi(
  app: FastifyInstance,
  o: { host: string; cookie: string; ip: string },
): SeedApi {
  const headers = { host: o.host, cookie: o.cookie, "x-forwarded-for": o.ip };
  return {
    json: async (method, url, body) =>
      answer(
        await app.inject({
          method,
          url,
          remoteAddress: o.ip,
          headers:
            body === undefined ? headers : { ...headers, "content-type": "application/json" },
          ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
        }),
      ),
    upload: async (url, file, filename, fields) => {
      const parts = Object.entries(fields).map(([name, value]) =>
        Buffer.from(
          `--${BOUNDARY}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        ),
      );
      const payload = Buffer.concat([
        ...parts,
        Buffer.from(
          `--${BOUNDARY}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\n` +
            "content-type: application/octet-stream\r\n\r\n",
        ),
        file,
        Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
      ]);
      return answer(
        await app.inject({
          method: "POST",
          url,
          remoteAddress: o.ip,
          headers: { ...headers, "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
          payload,
        }),
      );
    },
  };
}
