/** Moments' calls of Screen's images and zone names (contracts/screen.md, For Moments) over a fake Screen. */
import { describe, expect, it } from "vitest";
import { ServiceIdentity } from "@canccu/kit";
import { screenClient } from "../src/cues/screen.js";

const service = new ServiceIdentity({ module: "moments", key: "k".repeat(32) });

function screen(answer: (path: string) => Response): { asked: string[]; fetch: typeof fetch } {
  const asked: string[] = [];
  const fake = (url: string | URL | Request) => {
    const u = new URL(url instanceof Request ? url.url : url);
    asked.push(`${u.pathname}${u.search}`);
    return Promise.resolve(answer(u.pathname));
  };
  return { asked, fetch: fake };
}

describe("Screen's images for the photo picker", () => {
  it("lists the event's images, and none when Screen does not answer", async () => {
    const images = [{ id: "as_1", title: "Poster", url: "/api/screen/files/a.png" }];
    const ok = screen(() => Response.json({ images }));
    expect(await screenClient("http://screen/", service, ok.fetch).images("demo")).toEqual(images);
    expect(ok.asked).toEqual(["/internal/screen/images?tenant_id=demo"]);
    const down = screen(() => new Response("", { status: 503 }));
    expect(await screenClient("http://screen", service, down.fetch).images("demo")).toEqual([]);
  });

  it("reads an image's bytes with its type, and null for one the event lacks", async () => {
    const s = screen((path) =>
      path.endsWith("/as_1")
        ? new Response("bytes", { headers: { "content-type": "image/png" } })
        : new Response("{}", { status: 404 }),
    );
    const client = screenClient("http://screen", service, s.fetch);
    const got = await client.image("demo", "as_1");
    expect(got?.type).toBe("image/png");
    expect(got?.body.toString()).toBe("bytes");
    expect(await client.image("demo", "as_2")).toBeNull();
    expect(s.asked[0]).toBe("/internal/screen/images/as_1?tenant_id=demo");
  });
});

describe("Screen's zone names (#638)", () => {
  it("lists each zone's key and name, and none when Screen does not answer", async () => {
    const zones = [{ key: "main", name: "Main hall" }];
    const ok = screen(() => Response.json({ zones }));
    expect(await screenClient("http://screen", service, ok.fetch).zones("demo")).toEqual(zones);
    expect(ok.asked).toEqual(["/internal/screen/zones?tenant_id=demo"]);
    const down = screen(() => new Response("", { status: 503 }));
    expect(await screenClient("http://screen", service, down.fetch).zones("demo")).toEqual([]);
  });
});
