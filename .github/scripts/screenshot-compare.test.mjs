// Tests of screenshot-compare.mjs (docs/ci.md#weekly): PNG decoding with every row filter, and
// which screens count as changed a lot.
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { compare, decodePng, markdown } from "./screenshot-compare.mjs";

// A PNG as Chromium writes one: 8 bits a channel, not interlaced. Row r uses filter r % 5, so
// every filter is decoded.
function png(width, height, channels, pixel) {
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  const stride = width * channels;
  const raw = [];
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(stride);
    for (let x = 0; x < width; x++) row.set(pixel(x, y).slice(0, channels), x * channels);
    const filter = y % 5;
    const out = [filter];
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      out.push((row[i] - pred) & 0xff);
    }
    raw.push(...out);
    prev = row;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, channels === 4 ? 6 : 2, 0, 0, 0], 8);
  const idat = deflateSync(Buffer.from(raw));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat.subarray(0, 10)),
    chunk("IDAT", idat.subarray(10)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const gradient = (x, y) => [(x * 37 + y) & 0xff, (y * 53) & 0xff, (x * y) & 0xff, 255];

test("an RGB and an RGBA PNG decode to their pixels, through every row filter", () => {
  for (const channels of [3, 4]) {
    const img = decodePng(png(7, 10, channels, gradient));
    assert.equal(img.width, 7);
    assert.equal(img.height, 10);
    for (const [x, y] of [[0, 0], [6, 4], [3, 9], [5, 8]]) {
      const i = (y * 7 + x) * 4;
      assert.deepEqual([...img.data.subarray(i, i + 4)], gradient(x, y), `pixel ${x},${y} of ${channels}`);
    }
  }
});

test("an interlaced or 16-bit PNG is refused rather than misread", () => {
  const p = png(2, 2, 3, gradient);
  const sixteen = Buffer.from(p);
  sixteen[24] = 16;
  assert.throws(() => decodePng(sixteen), /8-bit/);
  const interlaced = Buffer.from(p);
  interlaced[28] = 1;
  assert.throws(() => decodePng(interlaced), /interlaced/);
});

function dirs(old, now) {
  const root = mkdtempSync(join(tmpdir(), "shots-"));
  const [a, b] = [join(root, "old"), join(root, "new")];
  for (const [dir, files] of [[a, old], [b, now]]) {
    mkdirSync(dir);
    for (const [name, buf] of Object.entries(files)) writeFileSync(join(dir, name), buf);
  }
  return [a, b];
}

test("screens whose pixels changed past the threshold are listed, worst first; added and gone ones too", () => {
  const same = png(10, 10, 3, gradient);
  const bit = png(10, 10, 3, (x, y) => (x === 0 && y === 0 ? [255, 255, 255] : gradient(x, y)));
  const half = png(10, 10, 3, (x, y) => (y < 5 ? [0, 0, 0] : gradient(x, y)));
  const all = png(10, 10, 3, () => [1, 2, 3]);
  const shade = png(10, 10, 3, (x, y) => gradient(x, y).map((v) => Math.min(255, v + 10)));
  const [a, b] = dirs(
    { "a.png": same, "b.png": same, "c.png": same, "d.png": same, "e.png": same, "gone.png": same },
    { "a.png": same, "b.png": bit, "c.png": half, "d.png": all, "e.png": shade, "new.png": same },
  );
  const got = compare(a, b, { threshold: 0.1 });
  assert.deepEqual(got.changed.map((c) => c.name), ["d.png", "c.png"], "1 % and anti-aliasing shades stay out");
  assert.ok(Math.abs(got.changed[1].ratio - 0.5) < 0.06);
  assert.deepEqual(got.added, ["new.png"]);
  assert.deepEqual(got.removed, ["gone.png"]);
  assert.equal(got.compared, 5);
});

test("a screen whose size changed counts as changed all over", () => {
  const [a, b] = dirs({ "a.png": png(10, 10, 3, gradient) }, { "a.png": png(10, 12, 3, gradient) });
  const got = compare(a, b, { threshold: 0.1 });
  assert.deepEqual(got.changed, [{ name: "a.png", ratio: 1, note: "10x10 → 10x12" }]);
});

test("the list reads as a table with the base and the threshold", () => {
  const md = markdown({ changed: [{ name: "x.png", ratio: 0.42 }], added: ["n.png"], removed: [], compared: 3 }, {
    base: "step-3",
    threshold: 0.1,
  });
  assert.match(md, /step-3/);
  assert.match(md, /\| x\.png \| 42 % \|/);
  assert.match(md, /n\.png/);
});
