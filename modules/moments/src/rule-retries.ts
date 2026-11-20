/**
 * A refused rule moment asks again (contracts/moments.md, Refusal with retry: "the answer, and the
 * rule, wait 30 s before asking again"). The refused request is kept per dedupe key with its
 * `retry_at`; until then the rule's own re-asks only refresh the kept request, and the tick asks
 * again when it is due. It stops asking once the moment would have ended (its TTL after the
 * rule's last ask), when it starts, or when its source ends.
 */
import type { SqlClient } from "@canccu/kit";
import type { Engine, MomentRequest, RequestResult } from "./engine.js";
import { DEFAULT_TTL_SECONDS } from "./engine.js";
import { loadRules } from "./rules.js";
import { rulesOff } from "./story/presets.js";
import { loadStories } from "./story/store.js";

const RETRY_MS = 30_000;

const giveUpAt = (r: MomentRequest, now: Date) =>
  new Date(now.getTime() + (r.ttl_seconds ?? DEFAULT_TTL_SECONDS) * 1000);

/**
 * The rule's ask: held back while a refusal of the same key waits its 30 s (the kept request is
 * refreshed instead), else asked, and kept for a retry when refused.
 */
export async function askForRule(
  c: SqlClient,
  engine: Engine,
  r: MomentRequest & { dedupe_key: string; rule_id: string },
  now: Date,
): Promise<RequestResult | null> {
  const { rows } = await c.query(
    `UPDATE moments_rule_retries SET request = $2, give_up_at = $3
     WHERE dedupe_key = $1 AND retry_at > $4 RETURNING dedupe_key`,
    [r.dedupe_key, JSON.stringify(r), giveUpAt(r, now), now],
  );
  if (rows.length > 0) return null;
  const answer = await engine.request(c, r, now);
  await settle(c, r, answer, now, giveUpAt(r, now));
  return answer;
}

async function settle(
  c: SqlClient,
  r: MomentRequest & { dedupe_key: string; rule_id: string },
  answer: RequestResult,
  now: Date,
  giveUp: Date,
): Promise<void> {
  const retryAt = new Date(now.getTime() + RETRY_MS);
  if (answer.status !== "refused" || retryAt >= giveUp) {
    await dropRetry(c, r.dedupe_key);
    return;
  }
  await c.query(
    `INSERT INTO moments_rule_retries (dedupe_key, rule_id, request, retry_at, give_up_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, dedupe_key) DO UPDATE
       SET request = EXCLUDED.request, retry_at = EXCLUDED.retry_at,
           give_up_at = EXCLUDED.give_up_at`,
    [r.dedupe_key, r.rule_id, JSON.stringify(r), retryAt, giveUp],
  );
}

/** The source ended, or the rule's moment ended for good: nothing asks again. */
export async function dropRetry(c: SqlClient, dedupeKey: string): Promise<void> {
  await c.query(`DELETE FROM moments_rule_retries WHERE dedupe_key = $1`, [dedupeKey]);
}

/** The tick's part: every refusal whose 30 s are over asks again. */
export async function retryRules(c: SqlClient, engine: Engine, now: Date): Promise<void> {
  await c.query(`DELETE FROM moments_rule_retries WHERE give_up_at <= $1`, [now]);
  const { rows } = await c.query(
    `SELECT request, give_up_at FROM moments_rule_retries WHERE retry_at <= $1
     ORDER BY retry_at FOR UPDATE SKIP LOCKED`,
    [now],
  );
  if (rows.length === 0) return;
  const rules = await loadRules(c);
  const stories = (await loadStories(c)).stories;
  for (const row of rows as { request: MomentRequest; give_up_at: Date }[]) {
    const old = row.request as MomentRequest & { dedupe_key: string; rule_id: string };
    const rule = rules.find((x) => x.rule_id === old.rule_id);
    // `why` is "rule: <event type>"; a preset on now may take that happening over.
    const type = old.why.replace(/^rule: /, "");
    if (rule === undefined || !rule.enabled || rulesOff(stories, type).has(old.rule_id)) {
      await dropRetry(c, old.dedupe_key);
      continue;
    }
    // The crew may have changed the rule since the refusal: ask with its settings now.
    const r = {
      ...old,
      class: rule.class,
      template: rule.template,
      regions: rule.regions,
      ttl_seconds: rule.ttl_seconds,
      zones: rule.zones,
      cue: rule.cue,
    };
    // Its TTL after the rule's last ask, as the TTL is now (the stored one came from the old TTL).
    const ttlMs = (ttl: number | null | undefined) => (ttl ?? DEFAULT_TTL_SECONDS) * 1000;
    const giveUp = new Date(
      row.give_up_at.getTime() - ttlMs(old.ttl_seconds) + ttlMs(rule.ttl_seconds),
    );
    await settle(c, r, await engine.request(c, r, now), now, giveUp);
  }
}
