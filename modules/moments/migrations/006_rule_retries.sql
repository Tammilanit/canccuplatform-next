-- A refused rule moment asks again (#611; contracts/moments.md, Refusal with retry). Additive: one
-- new table, per event under RLS, as 001.

-- One row per refused rule request (its dedupe key): the request as the rule last made it, when it
-- may ask again (`retry_at`, the refusal plus 30 s) and when it stops asking (`give_up_at`, the
-- rule's last ask plus its TTL: the moment would have ended by then).
CREATE TABLE moments_rule_retries (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  dedupe_key text NOT NULL,
  rule_id text NOT NULL,
  request jsonb NOT NULL,
  retry_at timestamptz NOT NULL,
  give_up_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, dedupe_key)
);
CREATE INDEX moments_rule_retries_due ON moments_rule_retries (tenant_id, retry_at);

ALTER TABLE moments_rule_retries ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_rule_retries FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_rule_retries USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON moments_rule_retries TO canccu_moments_app;
