/**
 * What Make it yours shows about the draft's logo (plan issue-784 D5, D13): the plate check's
 * advice and the logo's own colours, both kept by the stored file's name (its content's hash).
 */
import type { SqlClient } from "@canccu/kit";
import { isObject } from "./checks.js";
import { logoPalette } from "./colour-match.js";
import type { DraftRow } from "./drafts.js";
import type { FileStore } from "./files.js";
import { kindOf, logoAdvice, rasterLogo } from "./logo-plate.js";
import type { PlateAdvice } from "./logo-plate.js";
import { fillTokens } from "./tokens.js";

export interface LogoInfo {
  advice: PlateAdvice | undefined;
  /** The logo's own colours, offered first under each picker (D13). */
  palette: string[];
}

const palettes = new Map<string, string[]>();

/** The plate check and the logo's colours, for the draft's logo; both kept by the file's name. */
export async function logoInfo(c: SqlClient, files: FileStore, draft: DraftRow): Promise<LogoInfo> {
  const path = isObject(draft.manifest.images) ? draft.manifest.images.logo : undefined;
  if (typeof path !== "string") return { advice: undefined, palette: [] };
  const { rows } = await c.query(
    `SELECT file FROM theming_package_files WHERE owner = 'draft' AND path = $1 AND file IS NOT NULL`,
    [path],
  );
  const file = (rows[0] as { file: string } | undefined)?.file;
  const kind = file === undefined ? undefined : kindOf(file);
  if (file === undefined || kind === undefined) return { advice: undefined, palette: [] };
  const { background = "#000000", surface = "#000000" } = fillTokens(
    draft.manifest.tokens ?? {},
  ).colors;
  const read = (name: string) => files.read(name);
  const advice = await logoAdvice(read, file, { background, surface });
  let palette = palettes.get(file);
  if (palette === undefined) {
    const bytes = await read(file);
    palette =
      bytes === undefined
        ? []
        : logoPalette(
            await rasterLogo(bytes, kind).catch(() => ({
              data: new Uint8Array(),
              width: 0,
              height: 0,
            })),
          );
    if (palettes.size >= 64) palettes.delete(palettes.keys().next().value as string);
    palettes.set(file, palette);
  }
  return { advice, palette };
}
