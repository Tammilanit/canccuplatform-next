/** Decks and a scripted renderer for the render tests (protocol: modules/screen-render, server.py). */
import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { join } from "node:path";
import sharp from "sharp";

/** A real PDF of `count` 16:9 pages whose text uses a font it does not embed. */
export function pdfPages(count: number): Buffer {
  const content = "BT /F1 48 Tf 72 270 Td (Slide) Tj ET";
  const kids = Array.from({ length: count }, (_, i) => `${5 + i} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`,
    "<< /Type /Font /Subtype /TrueType /BaseFont /FancyUnembedded >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...Array.from(
      { length: count },
      () =>
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>",
    ),
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export type Behaviour =
  /** `hang`: the slides arrive, then the renderer never finishes. */
  | { slides: number; warnings?: unknown[]; hang?: boolean }
  | { error: { code: string; message: string } }
  | "hang";

export interface FakeRenderer {
  path: string;
  /** What the next request gets; each request reads it when it arrives. */
  behaviour: Behaviour;
  /** Requests received, and how many connections have closed. */
  requests: number;
  closed: number;
  close(): Promise<void>;
}

async function png(index: number): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 18, channels: 3, background: { r: index, g: 40, b: 80 } },
  })
    .png()
    .toBuffer();
}

async function answer(socket: Socket, behaviour: Behaviour): Promise<void> {
  const line = (body: unknown): boolean => socket.write(`${JSON.stringify(body)}\n`);
  if (behaviour === "hang") return;
  if ("error" in behaviour) {
    line({ ok: false, error: behaviour.error });
    return;
  }
  for (let i = 1; i <= behaviour.slides; i++) {
    const slide = await png(i);
    line({ slide: { index: i, width: 32, height: 18, bytes: slide.length } });
    socket.write(slide);
  }
  if (behaviour.hang) return;
  line({ ok: true, slide_count: behaviour.slides, warnings: behaviour.warnings ?? [] });
}

/** A renderer on a Unix socket in `dir` that answers each deck as `behaviour` says. */
export async function fakeRenderer(dir: string, behaviour: Behaviour): Promise<FakeRenderer> {
  const fake: FakeRenderer = {
    path: join(dir, "render.sock"),
    behaviour,
    requests: 0,
    closed: 0,
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
  const server: Server = createServer((socket) => {
    let buf = Buffer.alloc(0);
    let answered = false;
    socket.on("error", () => undefined);
    socket.on("close", () => (fake.closed += 1));
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const nl = buf.indexOf(10);
      if (answered || nl < 0) return;
      const header = JSON.parse(buf.subarray(0, nl).toString()) as { size: number };
      if (buf.length - nl - 1 < header.size) return;
      answered = true;
      fake.requests += 1;
      void answer(socket, fake.behaviour);
    });
  });
  await new Promise<void>((resolve) => server.listen(fake.path, resolve));
  return fake;
}
