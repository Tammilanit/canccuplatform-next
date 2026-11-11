/** Upload helpers for the asset tests: a multipart body as Studio sends it, and small media files. */
import { readFileSync } from "node:fs";
import type { LightMyRequestResponse } from "fastify";
import { VENUE_IP } from "./helpers.js";
import type { Call, Harness } from "./helpers.js";

/** A multipart upload of one file (and optionally a title or other fields), as Studio sends it. */
export function upload(
  h: Harness,
  url: string,
  file: Buffer,
  filename: string,
  c: Call & { title?: string; fields?: Record<string, string> } = {},
): Promise<LightMyRequestResponse> {
  const boundary = "canccu-test-boundary";
  const parts: Buffer[] = [];
  const fields = { ...(c.title === undefined ? {} : { title: c.title }), ...c.fields };
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\n` +
        "content-type: application/octet-stream\r\n\r\n",
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return h.app.inject({
    method: "POST",
    url,
    headers: {
      host: c.host ?? "alpha.test",
      "x-forwarded-for": c.ip ?? VENUE_IP,
      cookie: c.session ? `canccu_session=${c.session}` : "",
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat(parts),
  });
}

/** A small PNG; `seed` changes its bytes, so each seed is a file of its own. */
export async function png(seed = 0): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: seed % 256, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

export function fixture(name: string): Buffer {
  return readFileSync(new URL(`./fixtures/media/${name}`, import.meta.url));
}
