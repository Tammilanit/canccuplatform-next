/**
 * The archive rules of a package zip (contracts/theming.md, The theme package), with a hostile
 * fixture for each: any break refuses the whole zip, and nothing is ever written by its names.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readPackage } from "../src/zip.js";
import { packageZip, rawZip } from "./zips.js";

const MB = 1024 * 1024;
const yaml = Buffer.from("schema_version: 1\nname: T\nmode: simple\ntokens: {}\n");

async function refused(zip: Buffer): Promise<string> {
  const read = await readPackage(zip);
  if (read.ok) throw new Error("the zip was accepted");
  return read.why;
}

describe("readPackage", () => {
  it("answers each file's bytes by its path, directories left out", async () => {
    const read = await readPackage(
      rawZip([
        { name: "theme.yaml", data: yaml, deflate: true },
        { name: "images/", mode: 0o40755 },
        { name: "images/logo.svg", data: Buffer.from("<svg/>") },
      ]),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect([...read.files.keys()]).toEqual(["theme.yaml", "images/logo.svg"]);
    expect(read.files.get("theme.yaml")).toEqual(yaml);
  });

  it("refuses what is no zip", async () => {
    expect(await refused(Buffer.from("theme.yaml"))).toMatch(/no zip/);
  });

  describe("names", () => {
    it.each([
      ["/etc/passwd", /absolute/],
      ["C:/theme.yaml", /absolute/],
      ["images/../../theme.yaml", /\.\./],
      ["../theme.yaml", /\.\./],
      ["images\\..\\logo.svg", /characters/],
      ["images/./logo.svg", /a \. part/],
      ["images//logo.svg", /empty/],
      ["images/lögo.svg", /characters/],
    ])("refuses %s (zip slip and its cousins)", async (name, why) => {
      expect(await refused(rawZip([{ name, data: Buffer.from("x") }]))).toMatch(why);
    });

    it("refuses a name twice", async () => {
      const zip = rawZip([
        { name: "images/a.svg", data: Buffer.from("<svg/>") },
        { name: "images/a.svg", data: Buffer.from("<svg></svg>") },
      ]);
      expect(await refused(zip)).toMatch(/twice/);
    });
  });

  describe("entries", () => {
    it("refuses a symbolic link", async () => {
      const zip = rawZip([
        { name: "images/logo.svg", data: Buffer.from("/etc/passwd"), mode: 0o120777 },
      ]);
      expect(await refused(zip)).toMatch(/link/);
    });

    it("refuses a device or pipe", async () => {
      expect(await refused(rawZip([{ name: "images/p", mode: 0o010644 }]))).toMatch(/link/);
    });

    it("refuses an encrypted entry", async () => {
      const zip = rawZip([
        { name: "images/a.svg", data: Buffer.from("<svg/>"), deflate: true, encrypted: true },
      ]);
      expect(await refused(zip)).toMatch(/encrypted/);
    });

    it.each([
      ["a zip", packageZip({ "theme.yaml": yaml })],
      ["a gzip", Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0])],
      ["a 7z", Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4])],
      ["a tar", Buffer.concat([Buffer.alloc(257), Buffer.from("ustar\0")])],
    ])("refuses %s inside, whatever its name", async (_kind, inner) => {
      const zip = rawZip([{ name: "images/logo.png", data: inner, deflate: true }]);
      expect(await refused(zip)).toMatch(/archive/);
    });

    it("refuses an archive by its name too", async () => {
      expect(await refused(rawZip([{ name: "images/more.zip", data: Buffer.from("x") }]))).toMatch(
        /archive/,
      );
    });
  });

  describe("limits", () => {
    it("takes 300 files and refuses 301", async () => {
      const files = (n: number) =>
        rawZip(Array.from({ length: n }, (_, i) => ({ name: `images/${i}.svg`, data: yaml })));
      expect((await readPackage(files(300))).ok).toBe(true);
      expect(await refused(files(301))).toMatch(/300 files/);
    });

    it("refuses more than 20 MB unpacked (a bomb by size)", async () => {
      // Stored, not deflated: a ratio of 1:1, so only the size can refuse it.
      const chunk = randomBytes(5 * MB);
      const zip = rawZip([
        ...[0, 1, 2, 3].map((i) => ({ name: `images/${i}.png`, data: chunk })),
        { name: "images/4.png", data: randomBytes(1024) },
      ]);
      expect(await refused(zip)).toMatch(/20 MB/);
    });

    it("refuses an unpacking ratio over 100:1 (a bomb by ratio), before inflating it", async () => {
      const zip = rawZip([{ name: "images/zeros.png", data: Buffer.alloc(2 * MB), deflate: true }]);
      expect(await refused(zip)).toMatch(/100:1/);
    });

    it("refuses an entry whose headers understate its size", async () => {
      const zip = rawZip([
        { name: "images/big.png", data: randomBytes(64 * 1024), deflate: true, declared: 10 },
      ]);
      expect(await refused(zip)).toMatch(/size/);
    });
  });
});
