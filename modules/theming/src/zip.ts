/**
 * A package zip read as untrusted input (contracts/theming.md, The theme package; plan D2): entry by
 * entry from memory with a byte budget, never extracted to disk, so no name in it ever becomes a
 * path on the volume. Any break of the archive rules refuses the whole zip.
 */
import type { Readable } from "node:stream";
import yauzl from "yauzl";
import type { Entry, ZipFile } from "yauzl";

const MB = 1024 * 1024;
export const MAX_FILES = 300;
export const MAX_UNPACKED = 20 * MB;
const MAX_RATIO = 100;
/** Directories do not count as files, but a central directory of millions of them is no package. */
const MAX_ENTRIES = 1000;

export type Read = { ok: true; files: Map<string, Buffer> } | { ok: false; why: string };

/** First bytes of the archive formats a nested archive could hide in (by content, whatever its name). */
const ARCHIVE_MAGIC: { at: number; bytes: number[] }[] = [
  { at: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }, // zip
  { at: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }, // empty zip
  { at: 0, bytes: [0x50, 0x4b, 0x07, 0x08] }, // spanned zip
  { at: 0, bytes: [0x1f, 0x8b] }, // gzip
  { at: 0, bytes: [0x42, 0x5a, 0x68] }, // bzip2
  { at: 0, bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] }, // xz
  { at: 0, bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] }, // 7z
  { at: 0, bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] }, // rar
  { at: 0, bytes: [0x28, 0xb5, 0x2f, 0xfd] }, // zstd
  { at: 257, bytes: [0x75, 0x73, 0x74, 0x61, 0x72] }, // tar ("ustar")
];
const ARCHIVE_NAME = /\.(zip|jar|tar|tgz|gz|bz2|xz|7z|rar|zst)$/i;

const isArchive = (b: Buffer): boolean =>
  ARCHIVE_MAGIC.some(
    (m) => b.length >= m.at + m.bytes.length && m.bytes.every((x, i) => b[m.at + i] === x),
  );

/** Why `name` breaks the path rules, or undefined (yauzl has refused absolute and `..` names already). */
function nameError(name: string): string | undefined {
  if (/^([A-Za-z]:)?[/\\]/.test(name)) return "an absolute path";
  if (name.split("/").includes("..")) return "a path with ..";
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) {
    return "a path with characters other than A-Z, a-z, 0-9 and . _ / -";
  }
  const parts = (name.endsWith("/") ? name.slice(0, -1) : name).split("/");
  if (parts.includes("")) return "a path with an empty part";
  if (parts.includes(".")) return "a path with a . part";
  return undefined;
}

/** File type bits of a Unix `st_mode` in the upper external attributes (APPNOTE 4.4.15). */
const S_IFMT = 0o170000;
const PLAIN = new Set([0, 0o100000, 0o040000]);

class Refused extends Error {}

function readAll(stream: Readable, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // yauzl stops a stream that passes its declared size; this is the budget behind it.
      if (size > limit) {
        stream.destroy();
        reject(new Refused("its size is not what its headers say"));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", (err) => {
      reject(err instanceof Refused ? err : new Refused("its size is not what its headers say"));
    });
    stream.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
  });
}

function openStream(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err) reject(err);
      else resolve(stream);
    });
  });
}

/** The checks one entry passes before a byte of it is inflated. */
function entryError(entry: Entry, seen: Set<string>): string | undefined {
  const why = nameError(entry.fileName);
  if (why !== undefined) return why;
  if (seen.has(entry.fileName)) return "a name used twice";
  const type = ((entry.externalFileAttributes >>> 16) & S_IFMT) >>> 0;
  if (!PLAIN.has(type)) return "a link or special file, not a plain file";
  if (entry.isEncrypted()) return "an encrypted entry";
  if (entry.uncompressedSize > MAX_RATIO * Math.max(entry.compressedSize, 1)) {
    return "an unpacking ratio over 100:1";
  }
  if (ARCHIVE_NAME.test(entry.fileName)) return "an archive inside the archive";
  return undefined;
}

async function readEntries(zip: ZipFile): Promise<Map<string, Buffer>> {
  if (zip.entryCount > MAX_ENTRIES) throw new Refused(`it has more than ${MAX_FILES} files`);
  const files = new Map<string, Buffer>();
  const seen = new Set<string>();
  let unpacked = 0;
  let compressed = 0;
  const next = (): Promise<Entry | undefined> =>
    new Promise((resolve, reject) => {
      const done = (err: Error | undefined, entry?: Entry): void => {
        zip.off("entry", onEntry).off("end", onEnd).off("error", done);
        if (err) reject(err);
        else resolve(entry);
      };
      const onEntry = (entry: Entry): void => {
        done(undefined, entry);
      };
      const onEnd = (): void => {
        done(undefined);
      };
      zip.on("entry", onEntry).on("end", onEnd).on("error", done);
      zip.readEntry();
    });
  for (let entry = await next(); entry !== undefined; entry = await next()) {
    const why = entryError(entry, seen);
    if (why !== undefined) throw new Refused(`${entry.fileName}: ${why}`);
    seen.add(entry.fileName);
    if (entry.fileName.endsWith("/")) continue;
    if (files.size === MAX_FILES) throw new Refused(`it has more than ${MAX_FILES} files`);
    unpacked += entry.uncompressedSize;
    compressed += entry.compressedSize;
    // Declared sizes first, so a bomb is refused before it is inflated; yauzl holds every entry
    // to its declared size while inflating.
    if (unpacked > MAX_UNPACKED) throw new Refused("it unpacks to more than 20 MB");
    if (unpacked > MAX_RATIO * Math.max(compressed, 1)) {
      throw new Refused("its unpacking ratio is over 100:1");
    }
    let bytes: Buffer;
    try {
      bytes = await readAll(await openStream(zip, entry), entry.uncompressedSize);
    } catch (err) {
      throw new Refused(`${entry.fileName}: ${err instanceof Refused ? err.message : String(err)}`);
    }
    if (isArchive(bytes)) throw new Refused(`${entry.fileName}: an archive inside the archive`);
    files.set(entry.fileName, bytes);
  }
  return files;
}

export async function readPackage(body: Buffer): Promise<Read> {
  let zip: ZipFile;
  try {
    // strictFileNames: a backslash is refused, never read as a folder separator.
    zip = await yauzl.fromBufferPromise(body, {
      strictFileNames: true,
      validateEntrySizes: true,
      autoClose: false,
    });
  } catch {
    return { ok: false, why: "This is no zip archive." };
  }
  // Each read takes its own error listener; this one keeps a late error from crashing the process.
  zip.on("error", () => undefined);
  try {
    return { ok: true, files: await readEntries(zip) };
  } catch (err) {
    // yauzl's own refusals (absolute and `..` names, broken headers) are refusals too.
    const why = err instanceof Error ? err.message : String(err);
    return { ok: false, why: `This zip is refused: ${why}.` };
  } finally {
    zip.close();
  }
}
