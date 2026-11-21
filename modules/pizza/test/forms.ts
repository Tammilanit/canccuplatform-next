/** The pages as a browser reaches them: a GET, and a form posted urlencoded with its own key. */
import type { World } from "./helpers.js";

let forms = 0;

/** A page's form, posted as the browser does (urlencoded, with the form's own key). */
export function form(
  w: World,
  who: string | null,
  url: string,
  fields: Record<string, string> = {},
  host = "demo.test",
) {
  forms += 1;
  const body = new URLSearchParams({
    idempotency_key: `form-key-${String(forms).padStart(6, "0")}`,
    ...fields,
  }).toString();
  return w.app.inject({
    method: "POST",
    url,
    headers: {
      host,
      "content-type": "application/x-www-form-urlencoded",
      ...(who === null ? {} : { cookie: `canccu_session=${who}` }),
    },
    payload: body,
  });
}

/** A page, as `who` sees it. */
export function view(w: World, who: string | null, url: string, host = "demo.test") {
  return w.app.inject({
    method: "GET",
    url,
    headers: { host, ...(who === null ? {} : { cookie: `canccu_session=${who}` }) },
  });
}

let uploads = 0;

/** A form with a file, posted multipart as the browser does (one file field, several files). */
export function upload(
  w: World,
  who: string | null,
  url: string,
  files: { name: string; type: string; bytes: Buffer }[],
  fields: Record<string, string> = {},
  field = "photo",
) {
  uploads += 1;
  const boundary = `----pizzaTestBoundary${uploads}`;
  const parts: Buffer[] = [];
  const all = { idempotency_key: `upload-key-${String(uploads).padStart(6, "0")}`, ...fields };
  for (const [k, v] of Object.entries(all)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    );
  }
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`,
      ),
      f.bytes,
      Buffer.from("\r\n"),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return w.app.inject({
    method: "POST",
    url,
    headers: {
      host: "demo.test",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      ...(who === null ? {} : { cookie: `canccu_session=${who}` }),
    },
    payload: Buffer.concat(parts),
  });
}
