/**
 * A fetch for admin's settings API as the person, sent with the event's Host header. Admin finds
 * the event from the Host (contracts/admin.md, Settings), and Node's fetch never sends one it is
 * given: `host` is a forbidden header name in the Fetch standard, so the call reached admin with
 * admin's own address as Host and admin answered 404. node:http sends the header as given.
 *
 * Only what the kit's AdminClient sends is supported: a string body or none, and its deadline.
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export const hostFetch: typeof fetch = (input, init = {}) =>
  new Promise<Response>((resolve, reject) => {
    if (init.body !== undefined && init.body !== null && typeof init.body !== "string") {
      reject(new TypeError("hostFetch sends only a string body"));
      return;
    }
    const url = new URL(input instanceof Request ? input.url : input);
    const signal = init.signal ?? undefined;
    if (signal?.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        method: init.method ?? "GET",
        headers: Object.fromEntries(new Headers(init.headers).entries()),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers))
            for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v])
              headers.append(k, one);
          const status = res.statusCode ?? 502;
          // A Response refuses a body, even an empty one, for these statuses.
          const empty = status === 204 || status === 205 || status === 304;
          resolve(new Response(empty ? null : Buffer.concat(chunks), { status, headers }));
        });
      },
    );
    signal?.addEventListener("abort", () => req.destroy(signal.reason as Error), { once: true });
    req.on("error", reject);
    req.end(init.body ?? undefined);
  });
