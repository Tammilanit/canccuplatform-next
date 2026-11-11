-- Screen's copy of Moments' overrides, the claims it places on the zones (contracts/screen.md,
-- Moments drive it: claims; #307). Additive. `override` is null for an override whose end came
-- before its start; `event_id` is the newest event applied (UUID v7, which sorts by time), so an
-- event that comes twice or late changes nothing; an ended override keeps its row for that reason.
CREATE TABLE screen_claims (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  override_id text NOT NULL,
  override jsonb,
  left_zones text[] NOT NULL DEFAULT '{}',
  ended boolean NOT NULL DEFAULT false,
  event_id text COLLATE "C" NOT NULL,
  PRIMARY KEY (tenant_id, override_id)
);

ALTER TABLE screen_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_claims USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON screen_claims TO canccu_screen_app;
