// Compose smoke test: the screen container's own render client, through its read-only mount of
// the `render-socket` volume, against the real renderer (CI's compose job):
//   docker compose -f deploy/compose.yml exec -T screen node --input-type=module < modules/screen/test/render-smoke.mjs
import { writeFileSync } from "node:fs";

const dist = process.env.CANCCU_SCREEN_DIST ?? "/repo/modules/screen/dist";
const socketPath = process.env.CANCCU_RENDER_SOCKET ?? "/run/canccu-render/render.sock";
const { openRenderer, renderDeck } = await import(`${dist}/render/client.js`);

// Two 16:9 pages whose text uses a font the PDF does not embed.
const content = "BT /F1 48 Tf 72 270 Td (Slide) Tj ET";
const page =
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>";
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [5 0 R 6 0 R] /Count 2 >>",
  "<< /Type /Font /Subtype /TrueType /BaseFont /FancyUnembedded >>",
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  page,
  page,
];
let pdf = "%PDF-1.4\n";
const offsets = objects.map((body, i) => {
  const at = pdf.length;
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  return at;
});
const xref = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const deckPath = `/tmp/canccu-render-smoke-${process.pid}.pdf`;
writeFileSync(deckPath, pdf, "latin1");

let bytes = 0;
const outcome = await renderDeck({
  socket: await openRenderer(socketPath),
  deckPath,
  signal: new AbortController().signal,
  timeoutMs: 120_000,
  onSlide: async (_slide, png) => {
    bytes += png.length;
  },
});
const sizes = outcome.ok ? outcome.slides.map((s) => `${s.width}x${s.height}`).join(",") : "";
if (
  !outcome.ok ||
  sizes !== "3840x2160,3840x2160" ||
  outcome.warnings[0]?.code !== "font_missing"
) {
  console.error("render smoke failed:", JSON.stringify(outcome));
  process.exit(1);
}
console.log(`render smoke: 2 slides (${bytes} bytes) through screen's client and the socket`);
