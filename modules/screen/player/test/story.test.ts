// @vitest-environment happy-dom
/**
 * A storyboard on the screens (contracts/screen.md, The video step, Widgets; #114): the video
 * started in sync on two screens from the server clock, held while paused, muted where Moments
 * says, skipped (and reported) where it cannot play; a step's transition and cue picture; the
 * `title_card` widget.
 */
import { describe, expect, it } from "vitest";
import { claimShown } from "../src/claims.js";
import type { ClaimState } from "../src/claims.js";
import {
  skipVideo,
  takeErrors,
  videoItem,
  videoPosition,
  youtubeEmbed,
} from "../src/story-video.js";
import { drawWidget } from "../src/widget.js";

const T0 = Date.parse("2026-03-14T21:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const film = (o: Record<string, unknown> = {}) => ({
  kind: "video",
  url: "/api/screen/files/abc.mp4",
  title: "Last year",
  started_at: iso(T0),
  paused_at: null,
  muted_zones: ["cafe"],
  ...o,
});

function claim(over: Partial<ClaimState> = {}): ClaimState {
  return {
    override_id: "ov_story",
    hidden: false,
    role: "hero",
    rank: 65,
    template: "sting",
    content: {},
    steps: null,
    sound: null,
    on_end: "resume",
    starts_at: iso(T0),
    ends_at: null,
    expires_at: iso(T0 + 60_000),
    ...over,
  };
}

describe("the video step", () => {
  it("starts in sync on two screens: each from the server clock, whatever its own clock says", () => {
    // Two screens whose own clocks are 3 s apart, each corrected by its heartbeat's offset.
    const serverNow = T0 + 12_345;
    const screens = [
      { clock: serverNow - 1500, offset: 1500 },
      { clock: serverNow + 1500, offset: -1500 },
    ];
    const positions = screens.map((s) => videoPosition(film(), s.clock + s.offset));
    expect(positions).toEqual([12.345, 12.345]);
    for (const s of screens) {
      const el = drawWidget("video", null, film(), null, {
        sound: true,
        nowMs: s.clock + s.offset,
        claimId: "ov_v",
        zone: "main",
      });
      const video = el.querySelector("video") as HTMLVideoElement;
      expect(video.getAttribute("src")).toBe("/api/screen/files/abc.mp4");
      expect(video.currentTime).toBeCloseTo(12.345, 2);
      expect(video.muted).toBe(false);
      expect(video.loop).toBe(false);
    }
  });

  it("holds the frame it stopped on while paused, and is muted where Moments says", () => {
    const paused = film({ paused_at: iso(T0 + 30_000) });
    expect(videoPosition(paused, T0 + 90_000)).toBe(30);
    const el = drawWidget("video", null, paused, null, {
      sound: true,
      nowMs: T0 + 90_000,
      claimId: "ov_v",
      zone: "cafe",
    });
    const video = el.querySelector("video") as HTMLVideoElement;
    expect(video.autoplay).toBe(false);
    expect(video.muted).toBe(true);
    expect(videoItem(film(), "main")?.muted).toBe(false);
  });

  it("plays a YouTube video through the privacy-enhanced embed", () => {
    expect(youtubeEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&controls=0",
    );
    expect(youtubeEmbed("https://example.test/x")).toBeNull();
  });

  it("is skipped where it cannot play: the region shows its rotation, and the heartbeat says why", () => {
    const c = claim({ override_id: "ov_v", template: "video", content: film() });
    expect(claimShown(c, T0 + 1000)?.type).toBe("video");
    skipVideo("ov_v", "youtube-playback-error", "offline");
    expect(claimShown(c, T0 + 1000)).toBeNull();
    expect(takeErrors()).toEqual([
      { code: "youtube-playback-error", item_id: "ov_v", detail: "offline" },
    ]);
    expect(takeErrors()).toEqual([]);
  });
});

describe("a story's steps", () => {
  it("enter with their transition and draw their cue picture from the step's start", () => {
    const c = claim({
      steps: [
        {
          template: "sting",
          content: { text: "Starting soon" },
          duration_ms: 3000,
          transition: "flash",
        },
        {
          template: "title_card",
          content: { title: "Demo Game Cup final", subtitle: "Stage", image_url: null },
          duration_ms: 20_000,
          transition: "rise",
          effect: { name: "pop", hold_seconds: 60, fade_seconds: 10 },
        },
      ],
    });
    expect(claimShown(c, T0 + 1000)).toMatchObject({ type: "sting", transition: "flash" });
    expect(claimShown(c, T0 + 1000)?.cue).toBeUndefined();
    expect(claimShown(c, T0 + 5000)).toMatchObject({
      type: "title_card",
      transition: "rise",
      cue: { starts_at: iso(T0 + 3000), effect: { name: "pop" } },
    });
  });

  it("draws a title card with its title, subtitle and QR", () => {
    const el = drawWidget(
      "title_card",
      null,
      {
        title: "Welcome to Demo Event",
        subtitle: "Find your seat",
        image_url: null,
        qr: {
          url: "https://demo.test/notify/",
          label: "Venue info",
          image_url: "data:image/png;base64,AAAA",
        },
      },
      null,
    );
    expect(el.textContent).toContain("Welcome to Demo Event");
    expect(el.textContent).toContain("Find your seat");
    expect(el.textContent).toContain("Venue info");
  });
});
