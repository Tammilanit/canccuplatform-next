-- Screen's placements caught up after a restart (#611, E2). Additive: one new table, per event
-- under RLS, as 001.
-- The id of the newest `screen.claims.changed` applied on a zone: the replay of Screen's stream at
-- boot applies only newer ones, those the live subscription missed while Moments was down. Kept
-- apart from `moments_zones`, because the replay of an old `screen.zone.removed` deletes that row.
CREATE TABLE moments_claims_marks (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  zone_key text NOT NULL,
  claims_event_id text NOT NULL,
  PRIMARY KEY (tenant_id, zone_key)
);

ALTER TABLE moments_claims_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_claims_marks FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_claims_marks USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON moments_claims_marks TO canccu_moments_app;
