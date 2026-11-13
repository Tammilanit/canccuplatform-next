/**
 * The asset list, newest first, searched by title and kind, a page at a time: what
 * `GET /api/screen/assets` answers and Studio's Content page draws, from one query. Ported from the
 * legacy `asset-catalog.ts` (adapted: cursor pages instead of numbered ones, titles searched alone).
 */
import type { Db } from "../db.js";
import { invalidRequest } from "../http.js";
import { ASSET_KINDS, ASSET_SELECT, assetView, usedBy } from "./store.js";
import type { AssetKind, AssetRow } from "./store.js";

export const PAGE = 50;

export interface AssetQuery {
  q?: string | undefined;
  kind?: string | undefined;
  cursor?: string | undefined;
}

/**
 * `<created_at in microseconds since 1970>|<id>`, base64url: the last row of the page, newest
 * first. Microseconds, as Postgres keeps them: a JS Date has only milliseconds, and a cursor cut
 * to them would skip every row created within the same millisecond as the page's last.
 */
function decodeCursor(cursor: string): [string, string] {
  const match = /^(\d{1,17})\|([A-Za-z0-9_-]{1,64})$/.exec(
    Buffer.from(cursor, "base64url").toString(),
  );
  if (!match?.[1] || !match[2]) throw invalidRequest("`cursor` is not valid.");
  return [match[1], match[2]];
}

function encodeCursor(row: AssetRow & { cursor_us: string }): string {
  return Buffer.from(`${row.cursor_us}|${row.id}`).toString("base64url");
}

/** `%`, `_` and `\` in a search are meant literally. */
const likeText = (q: string): string => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

/** The contract's `Asset`s of one page and the cursor of the next, read in the current tenant. */
export async function listAssets(
  deps: { db: Db; now: () => number },
  query: AssetQuery,
): Promise<{ assets: Record<string, unknown>[]; next_cursor: string | null }> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (query.q !== undefined && query.q.trim() !== "") {
    if (query.q.length > 120) throw invalidRequest("`q` may be at most 120 characters.");
    values.push(likeText(query.q.trim()));
    where.push(`a.title ILIKE $${values.length}`);
  }
  if (query.kind !== undefined) {
    if (!ASSET_KINDS.includes(query.kind as AssetKind)) throw invalidRequest("Unknown `kind`.");
    values.push(query.kind);
    where.push(`a.kind = $${values.length}`);
  }
  if (query.cursor !== undefined) {
    const [micros, id] = decodeCursor(query.cursor);
    values.push(micros, id);
    const at = `timestamptz 'epoch' + $${values.length - 1}::bigint * interval '1 microsecond'`;
    where.push(`(a.created_at, a.id) < (${at}, $${values.length})`);
  }
  const select = ASSET_SELECT.replace(
    "SELECT ",
    "SELECT (extract(epoch FROM a.created_at) * 1000000)::bigint::text AS cursor_us, ",
  );
  const sql = `${select} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY a.created_at DESC, a.id DESC LIMIT ${PAGE + 1}`;
  const [rows, users] = await deps.db.tenant(async (c) => {
    const found = (await c.query(sql, values)).rows as unknown as (AssetRow & {
      cursor_us: string;
    })[];
    const ids = found.slice(0, PAGE).map((r) => r.id);
    return [found, await usedBy(c, ids, deps.now())] as const;
  });
  const page = rows.slice(0, PAGE);
  const last = page.at(-1);
  return {
    assets: page.map((row) => assetView(row, users.get(row.id) ?? [])),
    next_cursor: rows.length > PAGE && last ? encodeCursor(last) : null,
  };
}
