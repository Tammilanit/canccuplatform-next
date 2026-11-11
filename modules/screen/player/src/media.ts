/**
 * The `playlist` widget's media (contracts/screen.md, Widgets and CSP): the item the zone's tick
 * plays, drawn by the player itself, since a template may hold no `video` or `iframe`. Position
 * comes from the item's `started_at` on the server's clock, so every screen of the zone shows the
 * same moment, and a screen goes on to `next_item` by itself when the item ends.
 */

export interface PlayItem {
  kind: string;
  url: string;
  slide_urls: string[];
  started_at: string;
  offset_seconds: number;
  duration_seconds: number;
  muted: boolean;
}

export interface MediaOptions {
  /** This screen is the zone's sound device (`ScreenState.sound.enabled`). */
  sound: boolean;
  nowMs: number;
  /** The browser reports `prefers-reduced-motion: reduce`: an embed shows its still alone. */
  reducedMotion?: boolean;
}

/** contracts/screen.md, CSP: how a web asset is framed. */
const WEB_SANDBOX = "allow-scripts allow-same-origin allow-presentation";
const YOUTUBE = "https://www.youtube-nocookie.com";
/** The legacy Ready check, now the frame's load event (contracts/screen.md, CSP). */
export const FRAME_READY_MS = 8000;

const isItem = (v: unknown): v is PlayItem => {
  const x = v as Partial<PlayItem> | null;
  return (
    typeof x === "object" &&
    x !== null &&
    typeof x.kind === "string" &&
    typeof x.url === "string" &&
    typeof x.started_at === "string" &&
    typeof x.duration_seconds === "number"
  );
};

/**
 * The view's item, or its `next_item` once the item is over. The switch goes by the item's own
 * end, not the next one's `started_at`: content resumed after a break carries the virtual start
 * it would have had from its beginning, which falls before the break's last item ends.
 */
export function currentItem(view: Record<string, unknown>, nowMs: number): PlayItem | null {
  if (!isItem(view.item)) return null;
  const item = view.item;
  const next = view.next_item;
  const endsAt =
    Date.parse(item.started_at) + (item.duration_seconds - (item.offset_seconds || 0)) * 1000;
  if (isItem(next) && nowMs >= endsAt) return next;
  return item;
}

/** Seconds into the item at `nowMs`. */
const position = (item: PlayItem, nowMs: number): number =>
  Math.max(0, item.offset_seconds + (nowMs - Date.parse(item.started_at)) / 1000);

/** Only this host's files: the page's CSP would refuse anything else anyway. */
const ownPath = (url: string): boolean => /^\/(?![/\\])/.test(url);

function frame(src: string, sandbox: string, allow: string): HTMLIFrameElement {
  const el = document.createElement("iframe");
  el.className = "canccu-widget__media";
  el.setAttribute("sandbox", sandbox);
  el.setAttribute("allow", allow);
  el.setAttribute("referrerpolicy", "no-referrer");
  el.setAttribute("aria-hidden", "true");
  el.tabIndex = -1;
  el.src = src;
  // A page that never loads leaves the widget's own background, never a broken frame.
  const failed = setTimeout(() => {
    el.classList.add("canccu-is-failed");
  }, FRAME_READY_MS);
  el.addEventListener(
    "load",
    () => {
      clearTimeout(failed);
    },
    { once: true },
  );
  return el;
}

function youtubeSrc(url: string, item: PlayItem, o: MediaOptions): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== YOUTUBE) return null;
  const start = Number(u.searchParams.get("start") ?? 0) || 0;
  u.searchParams.set("start", String(start + Math.floor(position(item, o.nowMs))));
  // Autoplay with sound needs a gesture a kiosk never makes, and only the sound device may sound.
  if (item.muted || !o.sound) u.searchParams.set("mute", "1");
  return u.toString();
}

/** The element that shows the item; null when it cannot be shown here. */
export function drawMedia(item: PlayItem, o: MediaOptions): HTMLElement | null {
  switch (item.kind) {
    case "image":
    case "slide": {
      if (!ownPath(item.url)) return null;
      const img = document.createElement("img");
      img.className = "canccu-widget__media";
      img.alt = "";
      img.src = item.url;
      return img;
    }
    case "video": {
      if (!ownPath(item.url)) return null;
      const video = document.createElement("video");
      video.className = "canccu-widget__media";
      video.muted = item.muted || !o.sound;
      video.autoplay = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = item.url;
      // Before the metadata loads this sets where playback starts (HTML: default start position).
      video.currentTime = position(item, o.nowMs);
      return video;
    }
    case "web":
      return item.url.startsWith("https://") ? frame(item.url, WEB_SANDBOX, "") : null;
    case "youtube": {
      const src = youtubeSrc(item.url, item, o);
      return src === null ? null : frame(src, WEB_SANDBOX, "autoplay; encrypted-media");
    }
    default:
      return null;
  }
}

/** Settles once the element can be drawn, or has failed: what a fade waits for. */
export function whenReady(el: Element): Promise<void> {
  if (el instanceof HTMLImageElement) return el.decode().catch(() => undefined);
  const event =
    el instanceof HTMLVideoElement ? "loadeddata" : el instanceof HTMLIFrameElement ? "load" : null;
  if (event === null) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      resolve();
    };
    el.addEventListener(event, done, { once: true });
    el.addEventListener("error", done, { once: true });
  });
}
