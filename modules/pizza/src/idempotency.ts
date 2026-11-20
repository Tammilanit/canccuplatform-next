/**
 * Idempotent writes (E2): the same key from the same person within 24 hours answers what the first
 * request answered and does nothing again, so a double tap or a retry never sends a second event.
 * The key's row is written in the write's own transaction: a second request with the key waits on
 * the first and then reads its answer, and a write that failed (rolled back) leaves no key behind.
 */
import type { SqlClient } from "@canccu/kit";
import { InvalidBody } from "./validate.js";

export interface Answer {
  status: number;
  body: unknown;
}

const KEY = /^[A-Za-z0-9_-]{8,64}$/;

export function keyOf(header: unknown): string {
  if (typeof header !== "string" || !KEY.test(header)) {
    throw new InvalidBody(
      "Idempotency-Key",
      "every write carries a key of 8 to 64 letters, digits, - or _",
    );
  }
  return header;
}

export async function once(
  c: SqlClient,
  userId: string,
  key: string,
  now: Date,
  run: () => Promise<Answer>,
): Promise<Answer> {
  const { rows } = await c.query(
    `INSERT INTO pizza_idempotency (user_id, key, at) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING key`,
    [userId, key, now],
  );
  if (rows.length === 0) {
    const stored = await c.query(
      `SELECT status, body FROM pizza_idempotency WHERE user_id = $1 AND key = $2`,
      [userId, key],
    );
    const row = stored.rows[0] as { status: number | null; body: unknown } | undefined;
    if (row?.status != null) return { status: row.status, body: row.body };
  }
  const answer = await run();
  await c.query(
    `UPDATE pizza_idempotency SET status = $3, body = $4 WHERE user_id = $1 AND key = $2`,
    [userId, key, answer.status, JSON.stringify(answer.body ?? null)],
  );
  return answer;
}

/** Keys older than a day go (hourly upkeep). */
export async function dropOldKeys(c: SqlClient, now: Date): Promise<void> {
  await c.query(`DELETE FROM pizza_idempotency WHERE at < $1`, [
    new Date(now.getTime() - 24 * 3_600_000),
  ]);
}
