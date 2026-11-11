// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { currentItem, whenReady } from "../src/media.js";
import { drawWidget, identity, liveView } from "../src/widget.js";

const T0 = Date.parse("2026-01-01T12:00:00Z");
const iso = (ms: number): string => new Date(ms).toISOString();

const item = (over: Record<string, unknown> = {}) => ({
  kind: "image",
  url: "/api/screen/files/aaa.png",
  slide_urls: [],
  started_at: iso(T0),
  offset_seconds: 0,
  duration_seconds: 10,
  muted: true,
  ...over,
});
const view = (over: Record<string, unknown>) => ({ qr: null, stale: false, empty: false, ...over });
const playlist = (it: Record<string, unknown>, next: Record<string, unknown> | null = null) =>
  view({ item: it, next_item: next });

describe("the playlist widget's item", () => {
  const next = item({ url: "/api/screen/files/bbb.png", started_at: iso(T0 + 10_000) });

  it("is the server's item until it ends, then the next one, so a late push leaves no gap", () => {
    const v = playlist(item(), next);
    expect(currentItem(v, T0 + 9_999)?.url).toBe("/api/screen/files/aaa.png");
    expect(currentItem(v, T0 + 10_000)?.url).toBe("/api/screen/files/bbb.png");
    expect(currentItem(playlist(item()), T0 + 60_000)?.url).toBe("/api/screen/files/aaa.png");
    expect(currentItem(view({ empty: true }), T0)).toBeNull();
  });

  it("draws the same thing before and after the push that brings the item it already shows", () => {
    const before = liveView("playlist", playlist(item(), next), T0 + 10_500, "UTC");
    const pushed = liveView("playlist", playlist(next, null), T0 + 10_500, "UTC");
    expect(JSON.stringify(before)).toBe(JSON.stringify(pushed));
    expect(identity("playlist", before)).toBe(identity("playlist", pushed));
    expect(identity("playlist", before)).not.toBe(
      identity("playlist", liveView("playlist", playlist(item(), next), T0, "UTC")),
    );
  });

  it("names a photo by its address, so a new photo fades in", () => {
    expect(identity("photo", view({ url: "/a.jpg" }))).not.toBe(
      identity("photo", view({ url: "/b.jpg" })),
    );
    expect(identity("clock", view({ time: "12:00" }))).toBe(
      identity("clock", view({ time: "12:01" })),
    );
  });
});

describe("drawing the playlist widget", () => {
  const draw = (it: Record<string, unknown>, sound = false, now = T0) =>
    drawWidget("playlist", null, playlist(it), [], { sound, nowMs: now });

  it("shows an image or a deck's slide from this host", () => {
    const img = draw(item()).querySelector("img");
    expect(img?.getAttribute("src")).toBe("/api/screen/files/aaa.png");
    expect(img?.className).toBe("canccu-widget__media");
    const slide = draw(item({ kind: "slide", url: "/api/screen/renders/d/4/slide-2.png" }));
    expect(slide.querySelector("img")?.getAttribute("src")).toBe(
      "/api/screen/renders/d/4/slide-2.png",
    );
    expect(draw(item({ url: "https://elsewhere.example/x.png" })).querySelector("img")).toBeNull();
  });

  it("plays a video from where the zone is in it, with sound only on the zone's sound device", () => {
    const it = item({
      kind: "video",
      url: "/api/screen/files/v.mp4",
      duration_seconds: 20,
      muted: false,
    });
    const silent = draw(it, false, T0 + 4_500).querySelector("video") as HTMLVideoElement;
    expect(silent.getAttribute("src")).toBe("/api/screen/files/v.mp4");
    expect(silent.muted).toBe(true);
    expect(silent.autoplay).toBe(true);
    expect(silent.currentTime).toBeCloseTo(4.5);
    expect((draw(it, true).querySelector("video") as HTMLVideoElement).muted).toBe(false);
    const quiet = item({ kind: "video", url: "/api/screen/files/v.mp4", muted: true });
    expect((draw(quiet, true).querySelector("video") as HTMLVideoElement).muted).toBe(true);
  });

  it("frames a web page sandboxed, without a referrer", () => {
    const frame = draw(item({ kind: "web", url: "https://info.example/board" })).querySelector(
      "iframe",
    );
    expect(frame?.getAttribute("src")).toBe("https://info.example/board");
    expect(frame?.getAttribute("sandbox")).toBe(
      "allow-scripts allow-same-origin allow-presentation",
    );
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(
      draw(item({ kind: "web", url: "http://info.example/" })).querySelector("iframe"),
    ).toBeNull();
  });

  it("starts a YouTube embed where the zone is in it, muted unless it may sound", () => {
    const url = "https://www.youtube-nocookie.com/embed/abc?start=5&autoplay=1";
    const frame = draw(
      item({ kind: "youtube", url, muted: false }),
      false,
      T0 + 3_200,
    ).querySelector("iframe");
    const src = new URL(frame?.getAttribute("src") ?? "");
    expect(src.origin).toBe("https://www.youtube-nocookie.com");
    expect(src.searchParams.get("start")).toBe("8");
    expect(src.searchParams.get("mute")).toBe("1");
    const loud = draw(item({ kind: "youtube", url, muted: false }), true).querySelector("iframe");
    expect(new URL(loud?.getAttribute("src") ?? "").searchParams.get("mute")).toBeNull();
    const other = draw(item({ kind: "youtube", url: "https://evil.example/embed/x" }));
    expect(other.querySelector("iframe")).toBeNull();
  });

  it("is ready once its media can be drawn, or has failed", async () => {
    const video = document.createElement("video");
    const ready = whenReady(video);
    video.dispatchEvent(new Event("loadeddata"));
    await expect(ready).resolves.toBeUndefined();
    const frame = document.createElement("iframe");
    const failed = whenReady(frame);
    frame.dispatchEvent(new Event("error"));
    await expect(failed).resolves.toBeUndefined();
  });
});

describe("the embed widget", () => {
  it("draws through embedWidget(): the sandboxed frame over the logo", () => {
    const w = drawWidget(
      "embed",
      null,
      view({
        frame_url: "/theming/sandbox/3/fireworks/index.html",
        logo_url: "/theming/r/3/logo.svg",
      }),
      [],
    );
    expect(w.classList.contains("canccu-widget--embed")).toBe(true);
    const frame = w.querySelector("iframe.canccu-embed");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("src")).toBe("/theming/sandbox/3/fireworks/index.html");
    expect(w.querySelector("img")?.getAttribute("src")).toBe("/theming/r/3/logo.svg");
  });

  it("leaves the frame out when the viewer asks for reduced motion: the still alone", () => {
    const w = drawWidget(
      "embed",
      null,
      view({
        frame_url: "/theming/sandbox/3/fireworks/index.html",
        logo_url: "/theming/r/3/logo.svg",
      }),
      [],
      { sound: false, nowMs: T0, reducedMotion: true },
    );
    expect(w.querySelector("iframe")).toBeNull();
    expect(w.querySelector("img")).not.toBeNull();
  });

  it("frames nothing outside the sandbox, and stays the still", () => {
    const w = drawWidget(
      "embed",
      null,
      view({ frame_url: "https://evil.example/x.html", logo_url: "/theming/r/3/logo.svg" }),
      [],
    );
    expect(w.querySelector("iframe")).toBeNull();
    expect(w.querySelector("img")).not.toBeNull();
  });
});
