// A small library for the Content page's screenshots (#263; mockup 10): a poster, a deck the
// stack's renderer draws (its text uses a font the deck does not embed, so the shot shows a font
// warning), a video and a sound, uploaded as Studio uploads them. Removed again after the shots.
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { expect } from "./client.mjs";

const MEDIA = new URL("../fixtures/media/", import.meta.url);

/** A 1280×720 PNG in two colours, drawn without an image library. */
function poster() {
  const [w, h] = [1280, 720];
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const band = (x + y) % 320 < 160;
      row.set(band ? [32, 64, 160] : [240, 180, 40], 1 + x * 3);
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(bytes) {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** A PDF of `count` 16:9 pages, each titled, in a font it does not embed. */
function deck(count) {
  const kids = Array.from({ length: count }, (_, i) => `${4 + 2 * i} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`,
    "<< /Type /Font /Subtype /TrueType /BaseFont /BrandSans >>",
  ];
  for (let i = 1; i <= count; i++) {
    const text = `BT /F1 64 Tf 80 260 Td (Welcome, slide ${i}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * (i - 1)} 0 R >>`,
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    );
  }
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

async function add(demo, name, bytes) {
  const boundary = "canccu-content-shot";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\n` +
        "content-type: application/octet-stream\r\n\r\n",
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const type = `multipart/form-data; boundary=${boundary}`;
  return expect(await demo.call("POST", "/api/screen/assets", { body, type }), 201, name).body;
}

/** Uploads the library and waits up to a minute for the deck's render; answers the asset ids. */
export async function seedContent(demo) {
  const made = [
    await add(demo, "trailer.mp4", readFileSync(new URL("clip-h264-aac.mp4", MEDIA))),
    await add(demo, "chime.ogg", readFileSync(new URL("sound.ogg", MEDIA))),
    await add(demo, "poster-final.png", poster()),
    await add(demo, "welcome.pdf", deck(6)),
  ];
  const slides = made.at(-1);
  for (let tries = 0; tries < 60; tries++) {
    const { body } = await demo.call("GET", `/api/screen/render-jobs?asset_id=${slides.id}`);
    if (!["queued", "running"].includes(body?.jobs?.[0]?.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return made.map((a) => a.id);
}

export async function removeContent(demo, ids) {
  for (const id of ids) await demo.call("DELETE", `/api/screen/assets/${id}`).catch(() => {});
}
