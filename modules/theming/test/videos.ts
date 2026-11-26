/** Small, well-formed video files for the upload checks (plan issue-784 D19). */
/** An MP4's first box (`ftyp`, brand `isom`), then `size` bytes of media data. */
export function mp4(size = 64): Buffer {
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write("ftypisom", 4, "latin1");
  ftyp.writeUInt32BE(0x200, 12);
  ftyp.write("isomavc1", 16, "latin1");
  const mdat = Buffer.alloc(8 + size);
  mdat.writeUInt32BE(8 + size, 0);
  mdat.write("mdat", 4, "latin1");
  return Buffer.concat([ftyp, mdat]);
}

/** A WebM's EBML header (DocType `webm`), then a few bytes of segment. */
export function webm(): Buffer {
  const header = Buffer.from([
    0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81,
    0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x04,
    0x42, 0x85, 0x81, 0x02,
  ]);
  return Buffer.concat([header, Buffer.from([0x18, 0x53, 0x80, 0x67, 0x80])]);
}
