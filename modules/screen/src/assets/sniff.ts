/**
 * What an uploaded file is, read from its first and last bytes, never from its name or the type
 * the browser sent (contracts/screen.md, Content and scheduling: "files are checked by content").
 * The legacy upload trusted the file name; a renamed `.html` or `.svg` could pass as an image.
 */

export type FileKind = "image" | "video" | "audio" | "pptx" | "pdf";

export interface Sniffed {
  kind: FileKind;
  /** The stored file's extension and the type it is served with. */
  ext: string;
  mime: string;
  /** For messages: the container as people know it ("QuickTime", "Matroska"). */
  container: string;
  /** The ffprobe demuxer for video and sound, so a file is never read as anything else. */
  demuxer?: string;
}

/** Media containers recognised only to refuse them with a useful message. */
export interface Unplayable {
  kind: "unplayable";
  container: string;
  demuxer: string;
}

/** Photo formats the screens' browsers do not all show; refused with what to save instead. */
export interface UnplayableImage {
  kind: "unplayable-image";
  container: string;
}

const ascii = (buf: Buffer, start: number, end: number): string =>
  buf.subarray(start, end).toString("latin1");

/** An MPEG audio frame header: 11 sync bits, then a layer that is not "reserved". */
function mp3Frame(head: Buffer): boolean {
  return (
    head.length >= 2 &&
    head[0] === 0xff &&
    (head.readUInt8(1) & 0xe0) === 0xe0 &&
    (head.readUInt8(1) & 0x06) !== 0
  );
}

/** Matroska's EBML DocType sits within the header's first few dozen bytes. */
function ebmlDocType(head: Buffer): string | null {
  const at = head.indexOf(Buffer.from([0x42, 0x82]));
  if (at < 0 || at + 3 > head.length) return null;
  const size = head.readUInt8(at + 2) & 0x7f;
  return ascii(head, at + 3, at + 3 + size);
}

/**
 * A PPTX is a zip whose central directory, at the end, names `ppt/presentation.xml`; names are
 * stored uncompressed, so the bytes are there to find. The renderer inspects the deck in depth.
 */
function isPptx(head: Buffer, tail: Buffer): boolean {
  return ascii(head, 0, 4) === "PK\x03\x04" && tail.includes("ppt/presentation.xml", 0, "latin1");
}

/**
 * `head` is the file's first 4 KiB, `tail` its last 64 KiB (the zip central directory's usual
 * home). Null: nothing the screens show.
 */
export function sniff(head: Buffer, tail: Buffer): Sniffed | Unplayable | UnplayableImage | null {
  const four = ascii(head, 0, 4);
  const refuse = (container: string, demuxer: string): Unplayable => ({
    kind: "unplayable",
    container,
    demuxer,
  });
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return image("png", "image/png");
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return image("jpg", "image/jpeg");
  if (four === "GIF8") return image("gif", "image/gif");
  if (four === "RIFF" && ascii(head, 8, 12) === "WEBP") return image("webp", "image/webp");
  if (ascii(head, 0, 5) === "%PDF-") return file("pdf", "pdf", "application/pdf", "PDF");
  if (isPptx(head, tail)) {
    const mime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    return file("pptx", "pptx", mime, "PowerPoint");
  }
  if (ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    // iPhone photos (HEIC) and AVIF share the MP4 box format; they are pictures, not video.
    if (HEIF_BRANDS.has(brand)) {
      return { kind: "unplayable-image", container: brand.startsWith("avi") ? "AVIF" : "HEIF" };
    }
    if (brand === "qt  ") return refuse("QuickTime", "mov");
    if (brand.startsWith("M4A") || brand.startsWith("M4B")) return refuse("MPEG-4 audio", "mov");
    return file("video", "mp4", "video/mp4", "MP4", "mov");
  }
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) {
    return ebmlDocType(head) === "webm"
      ? file("video", "webm", "video/webm", "WebM", "matroska")
      : refuse("Matroska", "matroska");
  }
  if (four === "OggS") return file("audio", "ogg", "audio/ogg", "OGG", "ogg");
  if (ascii(head, 0, 3) === "ID3" || mp3Frame(head))
    return file("audio", "mp3", "audio/mpeg", "MP3", "mp3");
  if (four === "RIFF") {
    const form = ascii(head, 8, 12);
    if (form === "WAVE") return refuse("WAV", "wav");
    if (form === "AVI ") return refuse("AVI", "avi");
  }
  if (four === "fLaC") return refuse("FLAC", "flac");
  if (head[0] === 0x47 && head[188] === 0x47) return refuse("MPEG-TS", "mpegts");
  if (head.subarray(0, 4).equals(Buffer.from([0x30, 0x26, 0xb2, 0x75])))
    return refuse("Windows Media", "asf");
  return null;
}

const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "mif1",
  "msf1",
  "avif",
  "avis",
]);

function image(ext: string, mime: string): Sniffed {
  return { kind: "image", ext, mime, container: ext.toUpperCase() };
}

function file(
  kind: FileKind,
  ext: string,
  mime: string,
  container: string,
  demuxer?: string,
): Sniffed {
  return { kind, ext, mime, container, ...(demuxer ? { demuxer } : {}) };
}
