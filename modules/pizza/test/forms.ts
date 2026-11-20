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
