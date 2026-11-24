-- Airtime that is seen and nothing left out (#777). Additive: two tables and two columns.
-- Moments now decides who holds each zone's hero; a moment's TTL is on-air time per zone.

-- The arbiter's airtime settings (contracts/moments.md, Airtime); '{}' is every default.
ALTER TABLE moments_priorities ADD COLUMN airtime jsonb NOT NULL DEFAULT '{}';

-- When the moment was last fresh news (its start, or a renewal with new content): stale counts
-- from here. Null: its starts_at.
ALTER TABLE moments ADD COLUMN fresh_at timestamptz;

-- One moment on one zone: its place in the zone's queue and its on-air clock.
CREATE TABLE moment_slots (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  moment_id text NOT NULL,
  zone_key text NOT NULL,
  queued_since timestamptz NOT NULL,
  forward_at timestamptz,
  -- hero, rail, pass, inside (played within a condensed round) or null (held back).
  granted text,
  inside_of text,
  on_air_since timestamptz,
  played_ms bigint NOT NULL DEFAULT 0,
  -- played_ms when its current hold of the hero began: the floor counts from here.
  tenure_from_ms bigint NOT NULL DEFAULT 0,
  -- Null: no end of its own.
  budget_ms bigint,
  -- How many times it was sent to this zone: its override id's suffix (contracts/moments.md).
  generation integer NOT NULL DEFAULT 0,
  -- The override id it was last sent with on this zone, or null while held back.
  override_id text,
  PRIMARY KEY (tenant_id, moment_id, zone_key)
);
CREATE INDEX moment_slots_zone ON moment_slots (tenant_id, zone_key);

-- Each zone's hero: who holds it, and since when it is free (the breathing gap).
CREATE TABLE moments_zone_air (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  zone_key text NOT NULL,
  holder text,
  free_since timestamptz,
  PRIMARY KEY (tenant_id, zone_key)
);

ALTER TABLE moment_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE moment_slots FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moment_slots USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));
ALTER TABLE moments_zone_air ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_zone_air FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_zone_air USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON moment_slots, moments_zone_air TO canccu_moments_app;
