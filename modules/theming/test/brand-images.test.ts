/** The logo as PNG and the hub's icons, made at publish (contracts/theming.md, Reading the current theme). */
import sharp from "sharp";
import type { Sharp } from "sharp";
import { describe, expect, it } from "vitest";
import { draftFiles, png } from "./drafting.js";
import { DATABASE_URL, caller, get, send } from "./helpers.js";

interface Current {
  revision: number;
  logo_url?: string;
  logo_png_url?: string;
  icon_urls?: Record<string, string>;
  tokens: { colors: Record<string, string> };
}

const SVG_LOGO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20">' +
    '<rect width="40" height="20" fill="#ff0000"/></svg>',
);

describe.skipIf(!DATABASE_URL)("the logo PNG and the icons", () => {
  const t = draftFiles();

  /** Puts the files, sets the brand with them and publishes; answers the current theme. */
  async function publishWith(
    files: Record<string, Buffer>,
    brand: { logo?: string; icon?: string },
  ): Promise<Current> {
    let version = (await t.fresh()).draft_version;
    for (const [path, bytes] of Object.entries(files)) {
      const res = await t.put(path, version, bytes);
      expect(res.statusCode).toBe(200);
      version += 1;
    }
    const res = await send(t.h, "PUT", "/api/theming/draft/brand", {
      draft_version: version,
      primary: "#3b82f6",
      accent: "#f59e0b",
      scheme: "light",
      ...brand,
    });
    expect(res.statusCode).toBe(200);
    const pub = await send(t.h, "POST", "/api/theming/draft/publish", {
      draft_version: version + 1,
    });
    expect(pub.statusCode).toBe(201);
    return (await get(t.h, "/api/theming/current")).json<Current>();
  }

  async function served(url: string | undefined): Promise<Sharp> {
    expect(url).toMatch(/^\/theming\/a\/[0-9a-f]{64}\.png$/);
    const res = await get(t.h, url as string);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    return sharp(res.rawPayload);
  }

  const pixel = async (image: Sharp, x: number, y: number): Promise<number[]> => {
    const { data, info } = await image
      .clone()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const at = (y * info.width + x) * 4;
    return [...data.subarray(at, at + 4)];
  };

  it("renders the logo 512 px wide and the icons from it", async () => {
    const logo = await sharp({
      create: { width: 64, height: 32, channels: 4, background: "#ff0000" },
    })
      .png()
      .toBuffer();
    const current = await publishWith({ "images/logo.png": logo }, { logo: "images/logo.png" });
    expect(current.logo_url).toMatch(/^\/theming\/a\/[0-9a-f]{64}\.png$/);

    const logoPng = await served(current.logo_png_url);
    expect(await logoPng.metadata()).toMatchObject({ width: 512, height: 256, format: "png" });

    expect(Object.keys(current.icon_urls ?? {}).sort()).toEqual(["192", "512", "maskable_512"]);
    const small = await served(current.icon_urls?.["192"]);
    expect(await small.metadata()).toMatchObject({ width: 192, height: 192 });
    const large = await served(current.icon_urls?.["512"]);
    expect(await large.metadata()).toMatchObject({ width: 512, height: 512 });
    // A wide logo sits in the middle of the square icon; above it stays transparent.
    expect(await pixel(large, 256, 10)).toEqual([0, 0, 0, 0]);
    expect(await pixel(large, 256, 256)).toEqual([255, 0, 0, 255]);

    const maskable = await served(current.icon_urls?.maskable_512);
    expect(await maskable.metadata()).toMatchObject({ width: 512, height: 512 });
    // Opaque on the background, the logo inside the safe zone in the middle.
    const bg = current.tokens.colors.background as string;
    const rgb = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
    expect(await pixel(maskable, 0, 0)).toEqual([...rgb, 255]);
    expect(await pixel(maskable, 120, 256)).toEqual([255, 0, 0, 255]);
    expect(await pixel(maskable, 100, 256)).toEqual([...rgb, 255]);
  });

  it("renders an SVG logo sharp at 512 px", async () => {
    const current = await publishWith({ "images/logo.svg": SVG_LOGO }, { logo: "images/logo.svg" });
    expect(current.logo_url).toMatch(/\.svg$/);
    const logoPng = await served(current.logo_png_url);
    expect(await logoPng.metadata()).toMatchObject({ width: 512, height: 256 });
    expect(await pixel(logoPng, 511, 255)).toEqual([255, 0, 0, 255]);
  });

  it("makes the icons from images.icon when the brand has one", async () => {
    const current = await publishWith(
      { "images/logo.png": await png("#ff0000", 16), "images/icon.png": await png("#00ff00", 16) },
      { logo: "images/logo.png", icon: "images/icon.png" },
    );
    expect(await pixel(await served(current.logo_png_url), 10, 10)).toEqual([255, 0, 0, 255]);
    expect(await pixel(await served(current.icon_urls?.["192"]), 96, 96)).toEqual([0, 255, 0, 255]);
  });

  it("answers no logo and no icons for a theme without a logo", async () => {
    const current = await publishWith({}, {});
    expect(current).not.toHaveProperty("logo_url");
    expect(current).not.toHaveProperty("logo_png_url");
    expect(current).not.toHaveProperty("icon_urls");
  });

  it("gives a restored revision the same files, and never counts them as a change", async () => {
    const first = await publishWith(
      { "images/logo.png": await png("#ff0000", 16) },
      { logo: "images/logo.png" },
    );
    const draft = await send(t.h, "POST", "/api/theming/draft", { from: "current" });
    const republished = await send(t.h, "POST", "/api/theming/draft/publish", {
      draft_version: draft.json<{ draft_version: number }>().draft_version,
    });
    expect(republished.statusCode).toBe(201);
    const events = t.h.events("alpha");
    expect(events.at(-1)?.data).toMatchObject({ revision: 2, changed: [] });

    const restore = await send(t.h, "POST", "/api/theming/revisions/1/restore", {
      current_revision: 2,
    });
    expect(restore.statusCode).toBe(201);
    const current = (await get(t.h, "/api/theming/current")).json<Current>();
    expect(current.revision).toBe(3);
    expect(current.logo_png_url).toBe(first.logo_png_url);
    expect(current.icon_urls).toEqual(first.icon_urls);

    const pinned = await t.h.app.inject({
      method: "GET",
      url: "/internal/theming/revisions/1?tenant_id=alpha",
      headers: caller("screen"),
    });
    expect(pinned.json<Current>().logo_png_url).toBe(first.logo_png_url);
  });
});
