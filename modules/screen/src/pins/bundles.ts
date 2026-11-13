/**
 * The player bundles kept in the shared files volume (contracts/screen.md, Pins; plan #109 S4):
 * every container copies its own version in at start, so a pin can name a version no container
 * runs any more, and `/screen/b/<version>/` serves it from here. The store keeps the last 5
 * versions, the platform's own and every one a pin names or a timed pin restores (`prune`).
 */
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { platformFilesDir } from "@canccu/kit";
import { notFound } from "../http.js";

/** The files a bundle is: what `/screen/b/<version>/` serves. */
export const BUNDLE_FILES = new Map([
  ["player.js", "text/javascript; charset=utf-8"],
  ["player.css", "text/css; charset=utf-8"],
]);

/** How many of the newest versions are kept besides the held ones. */
const KEEP_NEWEST = 5;

/** A version as a directory name: never `.`, `..`, a hidden copy in progress or a path. */
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;

export const isBundleVersion = (value: unknown): value is string =>
  typeof value === "string" && VERSION_RE.test(value);

export function bundlesDir(filesRoot: string): string {
  return join(platformFilesDir("screen", filesRoot), "bundles");
}

export interface BundleStoreOptions {
  dir: string;
  /** This container's version, served from `playerDir` whether or not the copy worked. */
  current: string;
  playerDir: string;
}

export class BundleStore {
  readonly current: string;
  // Files never change under one version, so each is read once (a failed read is not kept).
  private readonly bytes = new Map<string, Promise<Buffer>>();

  constructor(private readonly o: BundleStoreOptions) {
    this.current = o.current;
  }

  /** Copies this version in, unless a container of the same version already did. */
  async install(): Promise<void> {
    if (!isBundleVersion(this.current)) return;
    const target = join(this.o.dir, this.current);
    if (await exists(target)) return;
    // Written aside and renamed into place, so no reader ever lists half a bundle.
    const tmp = join(this.o.dir, `.tmp-${randomBytes(6).toString("hex")}`);
    await mkdir(tmp, { recursive: true });
    try {
      for (const file of BUNDLE_FILES.keys()) {
        await copyFile(join(this.o.playerDir, file), join(tmp, file));
      }
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { recursive: true, force: true });
      // Another container of this version renamed its copy first: that one stands.
      if (!(await exists(target))) throw err;
    }
  }

  /** The versions a pin may name: this one first, then the kept ones, newest first. */
  async available(): Promise<string[]> {
    const kept = (await this.listed()).map((b) => b.version);
    return [this.current, ...kept.filter((v) => v !== this.current)];
  }

  async read(version: string, file: string): Promise<Buffer> {
    if (!BUNDLE_FILES.has(file) || !isBundleVersion(version)) throw notFound();
    const path =
      version === this.current ? join(this.o.playerDir, file) : join(this.o.dir, version, file);
    let pending = this.bytes.get(path);
    if (pending === undefined) {
      pending = readFile(path);
      pending.catch(() => this.bytes.delete(path));
      this.bytes.set(path, pending);
    }
    try {
      return await pending;
    } catch (err) {
      // A version not kept, or a dev server without the player build: a missing file.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw notFound();
      throw err;
    }
  }

  /** Removes every version but the newest 5, this one and the `held` ones. */
  async prune(held: ReadonlySet<string>): Promise<void> {
    const listed = await this.listed();
    for (const [i, b] of listed.entries()) {
      if (i < KEEP_NEWEST || b.version === this.current || held.has(b.version)) continue;
      await rm(join(this.o.dir, b.version), { recursive: true, force: true });
    }
  }

  /** The kept versions, newest copy first; the directory's time is when it was copied in. */
  private async listed(): Promise<{ version: string; at: number }[]> {
    let names: string[];
    try {
      names = await readdir(this.o.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const found = await Promise.all(
      names.filter(isBundleVersion).map(async (version) => {
        const s = await stat(join(this.o.dir, version)).catch(() => null);
        return s?.isDirectory() ? [{ version, at: s.mtimeMs }] : [];
      }),
    );
    return found.flat().sort((a, b) => b.at - a.at || b.version.localeCompare(a.version));
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}
