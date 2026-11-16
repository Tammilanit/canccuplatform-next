/**
 * Idempotent crew actions (E18): the same key from the same person within 24 hours answers what
 * the first request answered and does nothing again. The key's row is written in the action's own
 * transaction, so a second request with the key waits on the first and then reads its answer,
 * and an action that failed (rolled back) leaves no key behind.
 */
import type { SqlClient } from "@canccu/kit";
import { invalid } from "./content.js";

export interface Answer {
  status: number;
  body: unknown;
}

const KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** The request's key: the `Idempotency-Key` header, or a page form's `idempotency_key`. */
export function keyOf(header: unknown, body: unknown): string {
  const fromBody = (body as Record<string, unknown> | null | undefined)?.idempotency_key;
  const key = typeof header === "string" ? header : fromBody;
  if (typeof key !== "string" || !KEY.test(key)) {
    throw invalid(
      "Every crew action carries an `Idempotency-Key` of 8 to 64 letters, digits, - or _.",
    );
  }
  return key;
}

export async function once(
  c: SqlClient,
  userId: string,
  key: string,
  now: Date,
  run: () => Promise<Answer>,
): Promise<Answer> {
  const { rows } = await c.query(
    `INSERT INTO moments_idempotency (user_id, key, at) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING key`,
    [userId, key, now],
  );
  if (rows.length === 0) {
    const stored = await c.query(
      `SELECT status, body FROM moments_idempotency WHERE user_id = $1 AND key = $2`,
      [userId, key],
    );
    const row = stored.rows[0] as { status: number; body: unknown } | undefined;
    if (row !== undefined) return { status: row.status, body: row.body };
  }
  const answer = await run();
  await c.query(
    `UPDATE moments_idempotency SET status = $3, body = $4 WHERE user_id = $1 AND key = $2`,
    [userId, key, answer.status, JSON.stringify(answer.body ?? null)],
  );
  return answer;
}
