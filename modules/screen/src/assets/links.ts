/**
 * Web and YouTube assets (contracts/screen.md, Content and scheduling). Ported from the legacy
 * `web-asset.ts`, `youtube-asset.ts` and `youtube-oembed.ts`. The legacy host lists came from
 * environment variables with an event's own site as the default; here a web asset's origin must
 * be on the event's `web_allowlist` setting, and YouTube is the one fixed exception, embedded
 * from youtube-nocookie.com, the origin the screens' CSP frames.
 */
import { KitError } from "@canccu/kit";
import { invalidRequest } from "../http.js";

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const OEMBED_TIMEOUT_MS = 5000;

export type Health = "ok" | "degraded" | "error";
export interface HealthState {
  health: Health;
  health_message: string | null;
}

function httpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw invalidRequest("`url` is not a web address.");
  }
  if (url.protocol !== "https:") throw invalidRequest("`url` must start with https://.");
  if (url.username || url.password) throw invalidRequest("`url` may not hold a user or password.");
  return url;
}

/** The origins of `web_allowlist`; entries that are not https:// origins never match. */
function allowedOrigins(allowlist: unknown): Set<string> {
  const origins = new Set<string>();
  for (const entry of Array.isArray(allowlist) ? allowlist : []) {
    if (typeof entry !== "string") continue;
    try {
      const url = new URL(entry);
      if (url.protocol === "https:") origins.add(url.origin);
    } catch {
      // A malformed entry admin let through allows nothing.
    }
  }
  return origins;
}

/** The URL as stored, or 400 `origin_not_allowed` for an origin off the event's list. */
export function webUrl(value: string, allowlist: unknown): string {
  const url = httpsUrl(value);
  if (!allowedOrigins(allowlist).has(url.origin)) {
    throw new KitError(
      `${url.origin} is not on this event's list of web pages screens may show. Add it in the screen settings first.`,
      { status: 400, code: "origin_not_allowed" },
    );
  }
  return url.toString();
}

function videoId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;
  const [first, second] = url.pathname.split("/").filter(Boolean);
  const id =
    host === "youtu.be"
      ? first
      : url.pathname === "/watch"
        ? url.searchParams.get("v")
        : ["embed", "shorts", "live"].includes(first ?? "")
          ? second
          : null;
  return id && VIDEO_ID.test(id) ? id : null;
}

/** `t=90`, `t=90s`, `t=1m30s` or `start=90`, in seconds. */
function startSeconds(url: URL): number {
  const raw = url.searchParams.get("start") ?? url.searchParams.get("t") ?? "";
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw);
  if (!match) return 0;
  const [, h = "0", m = "0", s = "0"] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

export interface YouTubeLink {
  /** What the screens frame. */
  embed: string;
  /** What oEmbed is asked about. */
  watch: string;
}

/** A watch, short, live, embed or youtu.be link as the embed the screens frame. */
export function youtubeLink(value: string): YouTubeLink {
  const url = httpsUrl(value);
  const id = videoId(url);
  if (id === null) {
    throw invalidRequest("This is not a link to one YouTube video.");
  }
  const embed = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
  const start = startSeconds(url);
  if (start > 0) embed.searchParams.set("start", String(start));
  // The player starts it alone, shows no suggestions after it, and listens for its errors.
  embed.searchParams.set("autoplay", "1");
  embed.searchParams.set("rel", "0");
  embed.searchParams.set("enablejsapi", "1");
  return { embed: embed.toString(), watch: `https://www.youtube.com/watch?v=${id}` };
}

/**
 * Whether YouTube lets the video play in an embed: oEmbed answers 401, 403 or 404 for a private,
 * removed or not embeddable one. Anything else (a timeout, a 5xx) proves nothing either way.
 */
export async function probeYouTube(
  watch: string,
  fetchFn: typeof fetch = fetch,
): Promise<HealthState> {
  const url = new URL("https://www.youtube.com/oembed");
  url.searchParams.set("url", watch);
  url.searchParams.set("format", "json");
  let status: number;
  try {
    const response = await fetchFn(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
    });
    status = response.status;
  } catch {
    status = 0;
  }
  if (status === 200) return { health: "ok", health_message: null };
  if ([401, 403, 404].includes(status)) {
    return {
      health: "error",
      health_message:
        "This video cannot play in an embed: it is private, removed or not embeddable. Upload the original as an MP4.",
    };
  }
  return {
    health: "degraded",
    health_message: "YouTube could not be asked whether this video plays in an embed; it may.",
  };
}
