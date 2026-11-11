/**
 * The service worker's entry, `/screen/sw.js` (scope `/screen/`): the events, wired to the
 * cache logic in sw-core.ts. The page registers it with its bundle version (`?v=`), so a new
 * version installs a new worker, which drops the old bundle.
 */
import { ScreenCache } from "../src/sw-core.js";

declare const self: ServiceWorkerGlobalScope;

const cache = new ScreenCache({
  caches: self.caches,
  fetch: (input, init) => fetch(input, init),
  version: new URL(self.location.href).searchParams.get("v") ?? "dev",
  origin: self.location.origin,
});

self.addEventListener("install", (event) => {
  event.waitUntil(cache.install().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(cache.activate().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const answer = cache.respond(event.request);
  if (answer !== null) event.respondWith(answer);
});

self.addEventListener("message", (event) => {
  // Only this origin's own pages can reach a worker; still, take nothing but a list of strings.
  const data = event.data as { type?: unknown; files?: unknown } | null;
  if (data?.type !== "canccu-screen-files" || !Array.isArray(data.files)) return;
  const files = data.files.filter((f): f is string => typeof f === "string");
  event.waitUntil(cache.name(files));
});
