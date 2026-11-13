/**
 * The bundle's entry: the loader pages run this as their one script. `<body data-page>` says
 * which page: the kiosk (`/screen/`), a zone's virtual screen (`/screen/zones/<key>`) or the
 * kiosk check (`/screen/check`). Only the kiosk keeps state offline: a virtual screen is a
 * person's browser, whose cache must never become a kiosk's last screen.
 */
import "./player.css";
import "./screen.css";
import "./widgets.css";
import "./rail.css";
import "./claims.css";
import "./layouts.css";
import "./wall.css";
import { audioSettled, unlockOnGesture } from "./audio.js";
import { CheckPage } from "./check.js";
import { OfflineStore } from "./offline.js";
import { Player } from "./player.js";
import { VirtualScreen } from "./virtual.js";

const body = document.body;
const bundle = body.dataset.bundle ?? "dev";
const fetchFn = (input: string, init?: RequestInit): Promise<Response> => fetch(input, init);
const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;
// Neither exists outside a secure context (the plain-http IP-mode stack).
const worker = "serviceWorker" in navigator ? navigator.serviceWorker : undefined;
const caches = "caches" in globalThis ? globalThis.caches : undefined;

if (body.dataset.page === "zone") {
  const zone = new VirtualScreen({
    fetch: fetchFn,
    root: body,
    bundle,
    zone: body.dataset.zone ?? "",
    portrait: new URLSearchParams(location.search).get("orientation") === "portrait",
    reload: () => {
      location.reload();
    },
    reducedMotion,
  });
  addEventListener("message", (event) => {
    zone.preview(event, parent === window ? undefined : parent, location.origin);
  });
  void zone.start();
} else if (body.dataset.page === "check") {
  void new CheckPage({
    fetch: fetchFn,
    root: body,
    bundle,
    viewport: () => ({
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
    }),
    offline: () => ({
      available: worker !== undefined && caches !== undefined,
      active: worker?.controller != null,
    }),
  }).start();
} else {
  const offline = new OfflineStore({ caches, worker, origin: location.origin, now: Date.now });
  offline.register(bundle);
  unlockOnGesture(document);
  // The context made now has settled by the first heartbeat's `audio_unlocked`.
  void audioSettled();
  const player = new Player({
    fetch: fetchFn,
    nav: {
      hash: () => location.hash,
      // The transfer code is single use: drop it from the address, so a reload never sends it again.
      clearHash: () => {
        history.replaceState(null, "", location.pathname + location.search);
      },
      origin: () => location.origin,
      go: (url) => {
        location.assign(url);
      },
      reload: () => {
        location.reload();
      },
    },
    root: body,
    bundle,
    offline,
  });
  void player.start();
}
