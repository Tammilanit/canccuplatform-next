/**
 * Zips byte by byte, for the hostile fixtures: a zip library refuses to write what an attacker's
 * tool writes (absolute names, links, sizes that lie), so the tests build the archive themselves
 * (PKWARE APPNOTE 4.3: local headers, the central directory, its end record).
 */
import { crc32, deflateRawSync } from "node:zlib";

export interface RawEntry {
  name: string;
  data?: Buffer;
  deflate?: boolean;
  /** The Unix `st_mode` in the upper external attributes: a link is 0o120777. */
  mode?: number;
  /** The uncompressed size the headers declare, when it should lie. */
  declared?: number;
  encrypted?: boolean;
}

export function rawZip(entries: RawEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = e.data ?? Buffer.alloc(0);
    const body = e.deflate ? deflateRawSync(data) : data;
    const name = Buffer.from(e.name, "utf8");
    // Bit 11: the name is UTF-8; bit 0: encrypted.
    const flags = 0x0800 | (e.encrypted ? 1 : 0);
    const method = e.deflate ? 8 : 0;
    const size = e.declared ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    // Made by Unix (3), so the upper external attributes are a `st_mode`.
    entry.writeUInt16LE((3 << 8) | 20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(flags, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(size, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(((e.mode ?? 0o100644) << 16) >>> 0, 38);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, name, body);
    central.push(entry, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/** A package zip of `files` (path to content), each stored deflated as a tool would. */
export const packageZip = (files: Record<string, Buffer | string>): Buffer =>
  rawZip(
    Object.entries(files).map(([name, data]) => ({
      name,
      data: Buffer.isBuffer(data) ? data : Buffer.from(data),
      deflate: true,
    })),
  );
