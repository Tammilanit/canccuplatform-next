-- Moments' latest sound per zone (contracts/screen.md, Sound; step 4 plan D14), kept from
-- `moments.sound.played` and composed into `ScreenState.sound.play`. Additive. `event_id` is the
-- newest event applied (UUID v7, which sorts by time), so an event that comes twice or late
-- changes nothing, as in screen_claims.
CREATE TABLE screen_zone_sounds (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  zone_key text NOT NULL,
  sound jsonb NOT NULL,
  event_id text COLLATE "C" NOT NULL,
  PRIMARY KEY (tenant_id, zone_key)
);

ALTER TABLE screen_zone_sounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_zone_sounds FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_zone_sounds USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON screen_zone_sounds TO canccu_screen_app;
