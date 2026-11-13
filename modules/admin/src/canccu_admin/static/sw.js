// Admin's service worker (#440, docs/design/mockups.html sheet 8): when a signed-in phone loses
// its connection, an organiser page shows "You're offline" in its shell instead of the browser's
// own error. It only steps in when the network fails: every answer that arrives is passed on as is,
// and nothing but the offline page is ever cached. Served with `Service-Worker-Allowed: /`, as the
// organiser pages of every module share the shell (packages/ui menu.json).
const OFFLINE = "/admin/offline";
const CACHE = "canccu-offline";
const ORGANISER_PAGES = ["/admin/", "/agenda/", "/notify/admin/", "/theming/studio/"];
// The cached copy holds the menu of whoever is signed in; it is fetched again now and then, so a
// changed role shows. Signing out clears it (Clear-Site-Data on /admin/sign-out).
const REFRESH_MS = 10 * 60 * 1000;
let fetchedAt = 0;

async function refresh() {
  const answer = await fetch(OFFLINE, { cache: "no-store" });
  if (!answer.ok) return;
  await (await caches.open(CACHE)).put(OFFLINE, answer);
  fetchedAt = Date.now();
}

self.addEventListener("install", (event) => {
  event.waitUntil(refresh().catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!ORGANISER_PAGES.some((prefix) => url.pathname.startsWith(prefix))) return;
  event.respondWith(
    fetch(request).then(
      (answer) => {
        if (Date.now() - fetchedAt > REFRESH_MS) event.waitUntil(refresh().catch(() => undefined));
        return answer;
      },
      async () => (await caches.match(OFFLINE)) || Response.error(),
    ),
  );
});
