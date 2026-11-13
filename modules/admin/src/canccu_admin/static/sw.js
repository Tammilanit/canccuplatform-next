// Admin's service worker (#440, docs/design/mockups.html sheet 8): when a signed-in phone loses
// its connection, an organiser page shows "You're offline" in its shell instead of the browser's
// own error. It only steps in when the network fails: every answer that arrives is passed on as is,
// and nothing but the offline page and what it links is ever cached. Served with
// `Service-Worker-Allowed: /`, as the organiser pages of every module share the shell
// (packages/ui menu.json).
const OFFLINE = "/admin/offline";
const CACHE = "canccu-offline";
const ORGANISER_PAGES = ["/admin/", "/agenda/", "/notify/admin/", "/theming/studio/"];
// The cached copy holds the menu of whoever is signed in; it is fetched again now and then, so a
// changed role shows. Signing out clears it (Clear-Site-Data on /admin/sign-out).
const REFRESH_MS = 10 * 60 * 1000;
// What the offline page links (tests/test_sign_in_states.py holds the two in step). The HTTP
// cache is no help: offline, a browser does not serve a copy past its max-age, and sign-out's
// Clear-Site-Data empties it, so without these the page shows unstyled.
const ASSETS = ["/admin/static/ui.css", "/admin/static/shell.js"];
// The event's look, which every organiser page links after ui.css (contracts/theming.md, The
// current tokens, for pages). Kept when it answers, outside the all-or-nothing above: a hostname
// with no event answers 404, and the offline page then keeps ui.css's defaults.
const LOOK = "/theming/current/admin-tokens.css";
let fetchedAt = 0;

async function refresh() {
  const urls = [OFFLINE, ...ASSETS];
  const answers = await Promise.all(urls.map((url) => fetch(url, { cache: "no-store" })));
  // All or nothing: the old page with its old stylesheet beats a new page without one.
  if (!answers.every((answer) => answer.ok)) return;
  const cache = await caches.open(CACHE);
  await Promise.all(answers.map((answer, i) => cache.put(urls[i], answer)));
  fetchedAt = Date.now();
  const look = await fetch(LOOK, { cache: "no-store" }).catch(() => undefined);
  if (look?.ok) await cache.put(LOOK, look);
}

async function cached(path) {
  return (await caches.match(path)) || Response.error();
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
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === "GET" && [...ASSETS, LOOK].includes(url.pathname)) {
    event.respondWith(fetch(request).catch(() => cached(url.pathname)));
    return;
  }
  if (request.mode !== "navigate") return;
  if (!ORGANISER_PAGES.some((prefix) => url.pathname.startsWith(prefix))) return;
  event.respondWith(
    fetch(request).then(
      (answer) => {
        if (Date.now() - fetchedAt > REFRESH_MS) event.waitUntil(refresh().catch(() => undefined));
        return answer;
      },
      () => cached(OFFLINE),
    ),
  );
});
