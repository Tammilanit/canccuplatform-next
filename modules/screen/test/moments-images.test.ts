/**
 * The event's images for the crew spotlight's photo picker (contracts/screen.md, For Moments;
 * #624): Moments lists the image assets and shows each as a thumbnail to crew who may not hold
 * `screen.content.read`, so both answer only Moments' service identity, and only for images.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ServiceIdentity } from "@canccu/kit";
import { DATABASE_URL, SERVICE_KEY, fixture, harness, png, upload } from "./helpers.js";
import type { Harness } from "./helpers.js";

describe.skipIf(!DATABASE_URL)("the event's images for Moments", () => {
  let h: Harness;
  const moments = new ServiceIdentity({ module: "moments", key: SERVICE_KEY });
  const internal = (url: string, signed = true) =>
    h.app.inject({
      method: "GET",
      url,
      headers: { host: "screen:8080", ...(signed ? moments.headers("screen") : {}) },
    });
  let image = "";
  let older = "";
  let sound = "";

  beforeAll(async () => {
    h = await harness();
    const up = async (bytes: Buffer, name: string) =>
      (await upload(h, "/api/screen/assets", bytes, name, { session: "admin" })).json<{
        id: string;
      }>().id;
    older = await up(await png(1), "older.png");
    image = await up(await png(2), "poster.png");
    sound = await up(fixture("sound.ogg"), "chime.ogg");
  });
  afterAll(async () => {
    await h.close();
  });

  it("lists the image assets, newest first, with the file each one shows", async () => {
    const r = await internal("/internal/screen/images?tenant_id=alpha");
    expect(r.statusCode).toBe(200);
    const { images } = r.json<{ images: { id: string; title: string; url: string }[] }>();
    expect(images.map((i) => i.id)).toEqual([image, older]);
    expect(images[0]).toMatchObject({ title: "poster.png" });
    expect(images[0]?.url).toMatch(/^\/api\/screen\/files\/[a-f0-9]{64}\.png$/);
  });

  it("sends an image asset's file, and 404 for another kind or an unknown one", async () => {
    const r = await internal(`/internal/screen/images/${image}?tenant_id=alpha`);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("image/png");
    expect(r.rawPayload.subarray(1, 4).toString()).toBe("PNG");
    expect((await internal("/internal/screen/images/as_none?tenant_id=alpha")).statusCode).toBe(
      404,
    );
    expect((await internal(`/internal/screen/images/${sound}?tenant_id=alpha`)).statusCode).toBe(
      404,
    );
  });

  it("answers only Moments' service identity, and 404 for an event it does not know", async () => {
    expect((await internal("/internal/screen/images?tenant_id=alpha", false)).statusCode).toBe(401);
    expect(
      (await internal(`/internal/screen/images/${image}?tenant_id=alpha`, false)).statusCode,
    ).toBe(401);
    expect((await internal("/internal/screen/images?tenant_id=zzz")).statusCode).toBe(404);
  });
});
