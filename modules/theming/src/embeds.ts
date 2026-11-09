/** Embed files by owner, `draft` or `r:<revision>` (contracts/theming.md, Embeds; migrations/002). */
import type { SqlClient } from "@canccu/kit";
import type { EmbedExt, FileStore } from "./files.js";

/** The theme schema's embed file extensions, as stored (`jpeg` is stored as `jpg`). */
const EXTS: Record<string, EmbedExt> = {
  html: "html",
  js: "js",
  css: "css",
  json: "json",
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  webp: "webp",
  svg: "svg",
  woff2: "woff2",
};

/**
 * Store one embed for `owner`: `files` maps package paths (`embeds/<name>/…`, the entry included)
 * to bytes already through the upload checks. Publish (#241) and package uploads (#244) call it;
 * a call that breaks the package rules is their bug, so it throws rather than reporting a problem.
 */
export async function putEmbed(
  client: SqlClient,
  store: FileStore,
  owner: string,
  name: string,
  entry: string,
  files: ReadonlyMap<string, Buffer>,
): Promise<void> {
  const folder = `embeds/${name}/`;
  if (!files.has(entry))
    throw new Error(`embed ${name}: the entry ${entry} is not among its files`);
  for (const [path, bytes] of files) {
    if (!path.startsWith(folder)) throw new Error(`embed ${name}: ${path} is outside ${folder}`);
    const ext = EXTS[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
    if (ext === undefined) throw new Error(`embed ${name}: ${path} is no embed file type`);
    // The sandbox serves HTML only as the entry, and the entry only to a frame: one HTML per embed.
    if ((path === entry) !== (ext === "html")) {
      throw new Error(`embed ${name}: only the entry may be HTML, and it must be (${path})`);
    }
    const file = await store.put(client, bytes, ext);
    await client.query(
      `INSERT INTO theming_embed_files (owner, embed, path, file, entry) VALUES ($1, $2, $3, $4, $5)`,
      [owner, name, path.slice(folder.length), file, path === entry],
    );
  }
}

export interface EmbedRef {
  name: string;
  frame_url: string;
}

/** The embeds `owner` holds, by name, each with its entry's address under `base`. */
export async function listEmbeds(
  client: SqlClient,
  owner: string,
  base: string,
): Promise<EmbedRef[]> {
  const { rows } = await client.query(
    `SELECT embed, path FROM theming_embed_files WHERE owner = $1 AND entry ORDER BY embed`,
    [owner],
  );
  return (rows as { embed: string; path: string }[]).map((r) => ({
    name: r.embed,
    frame_url: `${base}${r.embed}/${r.path}`,
  }));
}

export interface EmbedFile {
  file: string;
  entry: boolean;
}

export async function findEmbedFile(
  client: SqlClient,
  owner: string,
  embed: string,
  path: string,
): Promise<EmbedFile | undefined> {
  const { rows } = await client.query(
    `SELECT file, entry FROM theming_embed_files WHERE owner = $1 AND embed = $2 AND path = $3`,
    [owner, embed, path],
  );
  return rows[0] as EmbedFile | undefined;
}
