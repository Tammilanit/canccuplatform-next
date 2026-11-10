/** Ported from the legacy `youtube-asset`, `youtube-oembed` and `web-asset` tests. */
import { describe, expect, it } from "vitest";
import { probeYouTube, webUrl, youtubeLink } from "../src/assets/links.js";

const ID = "dQw4w9WgXcQ";
const EMBED = `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&rel=0&enablejsapi=1`;

describe("youtubeLink", () => {
  it("turns watch, short, live, embed and youtu.be links into one embed", () => {
    for (const link of [
      `https://www.youtube.com/watch?v=${ID}&list=x`,
      `https://youtube.com/watch?v=${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}?feature=share`,
      `https://www.youtube.com/embed/${ID}`,
      ` https://www.youtube-nocookie.com/embed/${ID} `,
    ]) {
      expect(youtubeLink(link)).toEqual({
        embed: EMBED,
        watch: `https://www.youtube.com/watch?v=${ID}`,
      });
    }
  });

  it("keeps the start time in seconds", () => {
    const start = (link: string) => new URL(youtubeLink(link).embed).searchParams.get("start");
    expect(start(`https://youtu.be/${ID}?t=90`)).toBe("90");
    expect(start(`https://youtu.be/${ID}?t=90s`)).toBe("90");
    expect(start(`https://www.youtube.com/watch?v=${ID}&t=1m30s`)).toBe("90");
    expect(start(`https://www.youtube.com/embed/${ID}?start=12`)).toBe("12");
    expect(start(`https://youtu.be/${ID}?t=soon`)).toBeNull();
  });

  it("refuses other hosts, plain http, look-alikes and bad ids", () => {
    for (const link of [
      `http://www.youtube.com/watch?v=${ID}`,
      `https://www.youtube.com.evil.test/watch?v=${ID}`,
      `https://evilyoutube.com/watch?v=${ID}`,
      `https://www.youtube.com/watch?v=short`,
      `https://www.youtube.com/channel/${ID}`,
      "not a url",
    ]) {
      expect(() => youtubeLink(link)).toThrow();
    }
  });
});

describe("probeYouTube", () => {
  const answering = (status: number) => () => Promise.resolve(new Response("{}", { status }));

  it("asks oEmbed about the watch URL", async () => {
    let asked = "";
    await probeYouTube("https://www.youtube.com/watch?v=x", (url) => {
      asked = url instanceof Request ? url.url : url.toString();
      return Promise.resolve(new Response("{}"));
    });
    expect(asked).toBe(
      "https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dx&format=json",
    );
  });

  it("maps 200 to ok, 401, 403 and 404 to error, anything else to degraded", async () => {
    expect(await probeYouTube("w", answering(200))).toEqual({ health: "ok", health_message: null });
    for (const status of [401, 403, 404]) {
      expect((await probeYouTube("w", answering(status))).health).toBe("error");
    }
    expect((await probeYouTube("w", answering(503))).health).toBe("degraded");
    const down = () => Promise.reject(new Error("timeout"));
    expect((await probeYouTube("w", down)).health).toBe("degraded");
  });
});

describe("webUrl", () => {
  const allow = [
    "https://info.example",
    "https://scores.example:8443/ignored-path",
    "http://old.example",
    7,
  ];

  it("keeps a page whose origin is on the list", () => {
    expect(webUrl("https://info.example/today?x=1", allow)).toBe("https://info.example/today?x=1");
    expect(webUrl("https://scores.example:8443/", allow)).toBe("https://scores.example:8443/");
  });

  it("refuses other origins with origin_not_allowed, also subdomains and other ports", () => {
    for (const url of [
      "https://evil.example/",
      "https://sub.info.example/",
      "https://scores.example/",
      "https://old.example/",
    ]) {
      expect(() => webUrl(url, allow)).toThrow(
        expect.objectContaining({ code: "origin_not_allowed" }),
      );
    }
  });

  it("refuses plain http and credentials before the list", () => {
    expect(() => webUrl("http://info.example/", allow)).toThrow(
      expect.objectContaining({ code: "invalid_request" }),
    );
    expect(() => webUrl("https://me:pw@info.example/", allow)).toThrow(
      expect.objectContaining({ code: "invalid_request" }),
    );
    expect(() => webUrl("https://info.example/", "not a list")).toThrow(
      expect.objectContaining({ code: "origin_not_allowed" }),
    );
  });
});
