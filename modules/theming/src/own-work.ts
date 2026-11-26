/**
 * Whether the draft holds work of the organiser's own that applying a preset would drop (plan
 * issue-784 D11): CSS, fonts, templates or embeds other than its preset's. A draft from no preset
 * has its own as soon as it has any; one from a preset only once they differ from that preset's
 * (in theme.yaml or by file), since no Advanced edit clears `preset` and an exported draft keeps
 * it through Import. A saved preset (D18) is compared the same way, with the files it holds.
 */
import { isDeepStrictEqual } from "node:util";
import type { SqlClient } from "@canccu/kit";
import { isObject } from "./checks.js";
import type { Manifest } from "./checks.js";
import { embedHoldings } from "./embeds.js";
import { fileName } from "./files.js";
import { checkPackage } from "./package.js";
import { mineNumber } from "./my-presets.js";
import { PRESETS, presetFiles } from "./presets.js";
import type { Preset } from "./presets.js";

const PARTS = ["css", "fonts", "templates", "embeds"] as const;
const FOLDERS = ["css", "fonts", "templates"];

/** `<path>=<stored name>` of each file of the parts, and `<embed>/<path>=<name>` of the embeds. */
interface Print {
  paths: string[];
  embeds: string[];
}

/** A preset's print, as the package checks store its files; one per preset, kept. */
const presetPrints = new Map<string, Promise<Print>>();

async function printOfPreset(preset: Preset): Promise<Print> {
  const checked = await checkPackage(await presetFiles(preset));
  if (!checked.ok) throw new Error(`preset ${preset.id}: ${checked.why}`);
  const paths = [...checked.pkg.paths]
    .filter(([path]) => FOLDERS.includes(path.split("/")[0] ?? ""))
    .map(([path, e]) => `${path}=${"problem" in e ? "" : fileName(e.bytes, e.ext)}`);
  const embeds = [...checked.pkg.embeds].flatMap(([name, embed]) =>
    [...embed.files].map(
      ([path, f]) => `${name}/${path.slice(`embeds/${name}/`.length)}=${fileName(f.bytes, f.ext)}`,
    ),
  );
  return { paths: paths.sort(), embeds: embeds.sort() };
}

function presetPrint(preset: Preset): Promise<Print> {
  let print = presetPrints.get(preset.id);
  if (print === undefined) {
    print = printOfPreset(preset);
    presetPrints.set(preset.id, print);
  }
  return print;
}

/** The print of what `owner` holds: the draft, or a saved preset (`p:<n>`, D18). */
async function heldPrint(c: SqlClient, owner: string): Promise<Print> {
  const { rows } = await c.query(
    `SELECT path || '=' || coalesce(file, '') AS p FROM theming_package_files
      WHERE owner = $2 AND split_part(path, '/', 1) = ANY ($1)`,
    [FOLDERS, owner],
  );
  return {
    paths: (rows as { p: string }[]).map((r) => r.p).sort(),
    embeds: await embedHoldings(c, owner),
  };
}

/** A saved preset's manifest and print, as a platform preset's are compared; undefined if gone. */
async function savedOf(
  c: SqlClient,
  n: number,
): Promise<{ manifest: Manifest; print: Print } | undefined> {
  const { rows } = await c.query(`SELECT manifest FROM theming_presets WHERE id = $1`, [n]);
  const row = rows[0] as { manifest: Manifest } | undefined;
  return row && { manifest: row.manifest, print: await heldPrint(c, `p:${n}`) };
}

export async function ownWork(c: SqlClient, manifest: Manifest | undefined): Promise<boolean> {
  if (manifest === undefined) return false;
  // Files count even where theme.yaml names none: a replace drops them all the same.
  const print = await heldPrint(c, "draft");
  const id = isObject(manifest.preset) ? String(manifest.preset.id) : "";
  const n = mineNumber(id);
  const preset = n === undefined ? PRESETS.get(id) : await savedOf(c, n);
  if (preset === undefined) {
    return (
      PARTS.some((k) => manifest[k] !== undefined) ||
      print.paths.length > 0 ||
      print.embeds.length > 0
    );
  }
  if (PARTS.some((k) => !isDeepStrictEqual(manifest[k], preset.manifest[k]))) return true;
  return !isDeepStrictEqual(print, "print" in preset ? preset.print : await presetPrint(preset));
}
