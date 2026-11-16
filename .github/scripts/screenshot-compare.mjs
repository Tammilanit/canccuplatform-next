#!/usr/bin/env node
// The weekly run's screenshot comparison (docs/ci.md#weekly, #575): the screens of main against
// those of the last `step-<n>` tag, listing the ones that changed a lot. A list for the lead, not
// a check: screens change between steps on purpose. Node alone, no image package: Chromium's PNGs
// are 8-bit and not interlaced, which is all decodePng reads.
// Usage: screenshot-compare.mjs OLD_DIR NEW_DIR [--threshold 0.1] [--base NAME] [--out FILE]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { inflateSync } from "node:zlib";

// A channel off by this much or less is anti-aliasing or a gradient's dither, not a change.
const TOLERANCE = 32;
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePng(buf) {
  let pos = 8;
  let header;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const { width, height, depth, color, interlace } = header;
  const channels = CHANNELS[color];
  if (depth !== 8 || !channels) throw new Error(`only 8-bit grey, RGB and RGBA PNGs are read (depth ${depth}, colour ${color})`);
  if (interlace) throw new Error("interlaced PNGs are not read");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = (row[i] + pred) & 0xff;
    }
    const grey = channels < 3;
    const hasAlpha = channels === 2 || channels === 4;
    for (let x = 0, s = 0, d = y * width * 4; x < width; x++, s += channels, d += 4) {
      rgba[d] = row[s];
      rgba[d + 1] = grey ? row[s] : row[s + 1];
      rgba[d + 2] = grey ? row[s] : row[s + 2];
      rgba[d + 3] = hasAlpha ? row[s + channels - 1] : 255;
    }
    prev = row;
  }
  return { width, height, data: rgba };
}

function changedRatio(a, b) {
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let k = 0; k < 4; k++) {
      if (Math.abs(a.data[i + k] - b.data[i + k]) > TOLERANCE) {
        changed++;
        break;
      }
    }
  }
  return changed / (a.width * a.height);
}

export function compare(oldDir, newDir, { threshold }) {
  const pngs = (dir) => new Set(readdirSync(dir).filter((f) => f.endsWith(".png")));
  const [before, after] = [pngs(oldDir), pngs(newDir)];
  const changed = [];
  let compared = 0;
  for (const name of [...after].filter((n) => before.has(n)).sort()) {
    compared++;
    const [a, b] = [oldDir, newDir].map((dir) => decodePng(readFileSync(join(dir, name))));
    if (a.width !== b.width || a.height !== b.height) {
      changed.push({ name, ratio: 1, note: `${a.width}x${a.height} → ${b.width}x${b.height}` });
      continue;
    }
    const ratio = changedRatio(a, b);
    if (ratio >= threshold) changed.push({ name, ratio });
  }
  changed.sort((x, y) => y.ratio - x.ratio || x.name.localeCompare(y.name));
  return {
    changed,
    added: [...after].filter((n) => !before.has(n)).sort(),
    removed: [...before].filter((n) => !after.has(n)).sort(),
    compared,
  };
}

export function markdown({ changed, added, removed, compared }, { base, threshold }) {
  const pct = (r) => `${Math.round(r * 100)} %`;
  return [
    `# Screens against ${base}`,
    "",
    `${compared} screens in both; ${changed.length} changed in ${pct(threshold)} of their pixels or more.`,
    "",
    "| Screen | Pixels changed | Note |",
    "|---|---|---|",
    ...changed.map((c) => `| ${c.name} | ${pct(c.ratio)} | ${c.note ?? ""} |`),
    "",
    `New since ${base}: ${added.length ? added.join(", ") : "none"}`,
    "",
    `Gone since ${base}: ${removed.length ? removed.join(", ") : "none"}`,
    "",
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { threshold: { type: "string", default: "0.1" }, base: { type: "string", default: "the base" }, out: { type: "string" } },
  });
  const threshold = Number(values.threshold);
  if (positionals.length !== 2 || !(threshold > 0 && threshold <= 1)) {
    console.error("usage: screenshot-compare.mjs OLD_DIR NEW_DIR [--threshold 0.1] [--base NAME] [--out FILE]");
    process.exit(2);
  }
  const md = markdown(compare(positionals[0], positionals[1], { threshold }), { base: values.base, threshold });
  if (values.out) writeFileSync(values.out, md);
  console.log(md);
}
