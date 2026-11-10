/**
 * The file checks of one upload (contracts/theming.md, Upload safety), with a hostile fixture for
 * each: what passes is stored as checked (rasters re-encoded), what fails is a problem.
 */
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { checkFile } from "../src/uploads.js";
import type { Checked } from "../src/uploads.js";

const png = (width = 8, height = 8, background = "#3b82f6"): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 4, background } })
    .png()
    .toBuffer();

const svg = (body: string, head = ""): Buffer =>
  Buffer.from(`${head}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`);

/** A WOFF2 header (contracts/theming.md, Raster images and fonts) over `size` bytes. */
function woff2(size = 128, fix: Partial<{ length: number; tables: number; flavor: number }> = {}) {
  const b = Buffer.alloc(size);
  if (size < 48) return Buffer.from("wOF2").subarray(0, size);
  b.write("wOF2", 0, "latin1");
  b.writeUInt32BE(fix.flavor ?? 0x00010000, 4);
  b.writeUInt32BE(fix.length ?? size, 8);
  b.writeUInt16BE(fix.tables ?? 3, 12);
  b.writeUInt32BE(size * 2, 16);
  b.writeUInt32BE(Math.max(0, size - 48), 20);
  return b;
}

/** A PNG whose header claims `width`×`height`: the size a decoder would allocate. */
async function claimedPng(width: number, height: number): Promise<Buffer> {
  const b = Buffer.from(await png(1, 1));
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b.writeUInt32BE(crc32(b.subarray(12, 29)), 29);
  return b;
}

function problem(c: Checked): { code: string; path?: string } {
  if (c.ok) throw new Error("expected a problem");
  return c.problem;
}

function stored(c: Checked): { bytes: Buffer; ext: string } {
  if (!c.ok) throw new Error(`expected a pass, got ${c.problem.code}: ${c.problem.message}`);
  return c;
}

describe("content sniffing", () => {
  it("goes by the bytes, never the name: a mismatch is file_type", async () => {
    expect(problem(await checkFile("images/logo.svg", await png()))).toMatchObject({
      code: "file_type",
      path: "images/logo.svg",
    });
    expect(problem(await checkFile("images/logo.png", svg("")))).toMatchObject({
      code: "file_type",
    });
    expect(problem(await checkFile("images/logo.jpg", await png())).code).toBe("file_type");
    expect(problem(await checkFile("fonts/a.woff2", await png())).code).toBe("file_type");
    expect(problem(await checkFile("images/a.woff2", woff2())).code).toBe("file_type");
  });

  it("refuses what is no accepted type at all", async () => {
    const html = Buffer.from("<!doctype html><script>alert(1)</script>");
    expect(problem(await checkFile("images/x.png", html)).code).toBe("file_type");
    const gif = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1");
    expect(problem(await checkFile("images/x.png", gif)).code).toBe("file_type");
    expect(problem(await checkFile("images/x.png", Buffer.alloc(0))).code).toBe("file_type");
    expect(problem(await checkFile("images/x.gif", await png())).code).toBe("file_type");
  });

  it("stores JPEG as jpg, whichever of the two names the path uses", async () => {
    const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } })
      .jpeg()
      .toBuffer();
    expect(stored(await checkFile("images/a.jpeg", jpeg)).ext).toBe("jpg");
    expect(stored(await checkFile("images/a.JPG", jpeg)).ext).toBe("jpg");
  });
});

describe("raster images", () => {
  it("are decoded and stored re-encoded, dropping metadata", async () => {
    const tagged = await sharp(await png())
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret-location-62.6N" } })
      .toBuffer();
    expect(tagged.includes("secret-location")).toBe(true);
    const out = stored(await checkFile("images/photo.jpg", tagged));
    expect(out.bytes.includes("secret-location")).toBe(false);
    expect((await sharp(out.bytes).metadata()).exif).toBeUndefined();
  });

  it("drops a polyglot's payload: what follows the image never reaches the volume", async () => {
    const payload = "<script>alert(document.cookie)</script>";
    const polyglot = Buffer.concat([await png(), Buffer.from(payload)]);
    const out = stored(await checkFile("images/logo.png", polyglot));
    expect(out.ext).toBe("png");
    expect(out.bytes.includes(payload)).toBe(false);
    const comment = await sharp(await png())
      .jpeg()
      .toBuffer();
    // A JPEG comment segment carrying markup, right after the start of image.
    const withComment = Buffer.concat([
      comment.subarray(0, 2),
      Buffer.from([0xff, 0xfe, 0x00, payload.length + 2]),
      Buffer.from(payload),
      comment.subarray(2),
    ]);
    expect(stored(await checkFile("images/c.jpg", withComment)).bytes.includes(payload)).toBe(
      false,
    );
  });

  it("refuses an image that does not decode", async () => {
    const whole = await png(64, 64);
    expect(problem(await checkFile("images/cut.png", whole.subarray(0, 60))).code).toBe(
      "file_type",
    );
  });

  it("refuses more than 40 megapixels by the header, before decoding", async () => {
    expect(problem(await checkFile("images/bomb.png", await claimedPng(8000, 5001))).code).toBe(
      "file_too_large",
    );
    expect(problem(await checkFile("images/wide.png", await claimedPng(20000, 20000))).code).toBe(
      "file_too_large",
    );
  });

  it("keeps an animated WebP animated, and counts every frame's pixels", async () => {
    // Two different frames: the encoder merges identical ones.
    const frames = [await png(4, 4), await png(4, 4, "#f97316")];
    const animated = await sharp(frames, { join: { animated: true } })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    const out = stored(await checkFile("images/spin.webp", animated));
    expect((await sharp(out.bytes, { animated: true }).metadata()).pages).toBe(2);
  });

  it("refuses a raster over 5 MB", async () => {
    const big = Buffer.concat([await png(), Buffer.alloc(5 * 1024 * 1024)]);
    expect(problem(await checkFile("images/big.png", big)).code).toBe("file_too_large");
  });
});

describe("SVG", () => {
  it("passes a plain drawing unchanged, with local references", async () => {
    const drawing = svg(
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
        '<style>.a { fill: url(#g); }</style><rect class="a" width="10" height="10" fill="url(\'#g\')"/>' +
        '<use href="#g"/><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#g"/>',
      '<?xml version="1.0" encoding="UTF-8"?>\n<!-- a comment -->\n',
    );
    const out = stored(await checkFile("images/logo.svg", drawing));
    expect(out).toMatchObject({ ext: "svg" });
    expect(out.bytes.equals(drawing)).toBe(true);
  });

  it("passes an SVG with a byte order mark", async () => {
    const marked = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), svg("<rect/>")]);
    expect(stored(await checkFile("images/logo.svg", marked)).ext).toBe("svg");
  });

  const hostile: [string, Buffer][] = [
    ["a DOCTYPE", svg("", '<!DOCTYPE svg [<!ENTITY x "boom">]>')],
    ["an entity", svg("<text>&x;</text>", '<!DOCTYPE svg [<!ENTITY x "&#60;script&#62;">]>')],
    ["an entity without a DOCTYPE", svg("<text>&x;</text>")],
    ["a billion laughs", svg("", '<!DOCTYPE l [<!ENTITY a "aa"><!ENTITY b "&a;&a;">]>')],
    ["script", svg("<script>alert(1)</script>")],
    ["script in another namespace", svg('<h:script xmlns:h="http://www.w3.org/1999/xhtml"/>')],
    ["SCRIPT in capitals", svg("<SCRIPT>alert(1)</SCRIPT>")],
    ["foreignObject", svg('<foreignObject><img src="x" onerror="alert(1)"/></foreignObject>')],
    ["iframe", svg('<iframe src="https://evil.example"/>')],
    ["embed", svg('<embed src="https://evil.example"/>')],
    ["object", svg('<object data="https://evil.example"/>')],
    ["audio", svg('<audio src="https://evil.example/a.mp3"/>')],
    ["video", svg('<video src="https://evil.example/a.mp4"/>')],
    ["an on* attribute", svg('<rect onload="alert(1)"/>')],
    ["an on* attribute in capitals", svg('<rect ONCLICK="alert(1)"/>')],
    ["animate on href", svg('<a href="#x"><animate attributeName="href" to="javascript:1"/></a>')],
    [
      "set on xlink:href",
      svg('<a href="#x"><set attributeName="xlink:href" to="https://evil.example"/></a>'),
    ],
    ["set on an event handler", svg('<rect><set attributeName="onclick" to="alert(1)"/></rect>')],
    ["an external href", svg('<image href="https://evil.example/track.png"/>')],
    [
      "an external xlink:href",
      svg(
        '<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://evil.example/a.svg#x"/>',
      ),
    ],
    ["a javascript: href", svg('<a href="javascript:alert(1)"><text>x</text></a>')],
    ["an entity-encoded javascript: href", svg('<a href="&#106;avascript:alert(1)"/>')],
    ["a data: href", svg('<image href="data:image/svg+xml;base64,PHN2Zz4="/>')],
    ["a relative href", svg('<image href="other.svg"/>')],
    ["url() outside the file", svg('<rect style="fill: url(https://evil.example/p.svg#a)"/>')],
    ["url() in a presentation attribute", svg('<rect filter="url(https://evil.example/f#x)"/>')],
    ["@import", svg('<style>@import "https://evil.example/a.css";</style>')],
    [
      "@import in CDATA",
      svg("<style><![CDATA[@import url(https://evil.example/a.css);]]></style>"),
    ],
    [
      "a CSS-escaped url()",
      svg("<style>.a { background: u\\72l(https://evil.example/x) }</style>"),
    ],
    ["a CSS-escaped @import", svg('<style>@\\69mport "https://evil.example/a.css";</style>')],
    [
      "image-set()",
      svg('<style>.a { background: image-set("https://evil.example/x" 1x) }</style>'),
    ],
    [
      "a data: URL in CSS",
      svg("<style>.a { background: url(data:image/png;base64,AAAA) }</style>"),
    ],
    ["an xml-stylesheet", svg("", '<?xml-stylesheet href="https://evil.example/a.css"?>')],
  ];
  it.each(hostile)("refuses %s with svg_forbidden", async (_what, bytes) => {
    expect(problem(await checkFile("images/logo.svg", bytes))).toMatchObject({
      code: "svg_forbidden",
      path: "images/logo.svg",
    });
  });

  it("refuses what is not well-formed or not an SVG as file_type", async () => {
    expect(problem(await checkFile("images/a.svg", Buffer.from("<svg><g></svg>"))).code).toBe(
      "file_type",
    );
    const html = Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><svg/></html>');
    expect(problem(await checkFile("images/a.svg", html)).code).toBe("file_type");
    // A root `svg` outside the SVG namespace is no SVG to a browser.
    expect(problem(await checkFile("images/a.svg", Buffer.from("<svg></svg>"))).code).toBe(
      "file_type",
    );
    const latin1 = Buffer.concat([svg("<text>"), Buffer.from([0xe9]), Buffer.from("</text>")]);
    expect(problem(await checkFile("images/a.svg", latin1)).code).toBe("file_type");
  });

  it("refuses an SVG over 512 KB", async () => {
    const big = svg(`<!-- ${"x".repeat(512 * 1024)} -->`);
    expect(problem(await checkFile("images/big.svg", big)).code).toBe("file_too_large");
  });
});

describe("WOFF2", () => {
  it("passes a font by its header, stored as sent", async () => {
    const font = woff2();
    const out = stored(await checkFile("fonts/body.woff2", font));
    expect(out.ext).toBe("woff2");
    expect(out.bytes.equals(font)).toBe(true);
  });

  it("refuses a header that does not describe the file", async () => {
    expect(problem(await checkFile("fonts/a.woff2", woff2(128, { length: 4096 }))).code).toBe(
      "file_type",
    );
    expect(problem(await checkFile("fonts/a.woff2", woff2(128, { tables: 0 }))).code).toBe(
      "file_type",
    );
    expect(problem(await checkFile("fonts/a.woff2", woff2(128, { flavor: 0x41414141 }))).code).toBe(
      "file_type",
    );
    expect(problem(await checkFile("fonts/a.woff2", woff2(40))).code).toBe("file_type");
    const html = Buffer.concat([Buffer.from("wOF2"), Buffer.from("<script>alert(1)</script>")]);
    expect(problem(await checkFile("fonts/a.woff2", html)).code).toBe("file_type");
  });

  it("refuses a font over 1 MB", async () => {
    expect(problem(await checkFile("fonts/a.woff2", woff2(1024 * 1024 + 1))).code).toBe(
      "file_too_large",
    );
  });
});
