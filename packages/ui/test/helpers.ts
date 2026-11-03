import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Read a file relative to the repo root. */
export function repoFile(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");
}

/** Read a file relative to packages/ui. */
export function pkgFile(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}
