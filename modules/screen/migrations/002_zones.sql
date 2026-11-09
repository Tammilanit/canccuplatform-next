-- Zones and assignments (contracts/screen.md, Zones and assignments; #220). Additive: two new
-- per-tenant tables and three nullable columns on assignments.

CREATE TABLE screen_zones (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  key text NOT NULL,
  name text NOT NULL,
  layout_id text,
  regions jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {"enabled", "device_id"}; device_id is checked in the app (a device of this zone), and cleared
  -- by the one detach function when that device leaves (src/assignments.ts).
  sound jsonb NOT NULL DEFAULT '{"enabled": true, "device_id": null}'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  -- New on every create, so a zone removed and made again under one key never resumes the old
  -- one's stream versions (contracts/screen.md, Composed state and the push channel).
  epoch text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
ALTER TABLE screen_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_zones FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_zones USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

-- One row per event whose `main` zone was made once, so deleting `main` does not bring it back.
CREATE TABLE screen_zone_seeds (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  seeded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id)
);
ALTER TABLE screen_zone_seeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_zone_seeds FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_zone_seeds USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

-- At most one of a zone, a mirrored device or a mirrored zone; none is a paired, unassigned device.
-- The foreign keys (no cascade) are the backstop of zone_in_use and of "no dangling references":
-- a zone or a mirrored device's row cannot go while something still names it.
ALTER TABLE assignments ADD COLUMN zone_key text;
ALTER TABLE assignments ADD COLUMN mirror_device_id text;
ALTER TABLE assignments ADD COLUMN mirror_zone_key text;
ALTER TABLE assignments ADD CONSTRAINT assignments_one_target
  CHECK (num_nonnulls(zone_key, mirror_device_id, mirror_zone_key) <= 1);
ALTER TABLE assignments ADD CONSTRAINT assignments_not_self CHECK (mirror_device_id <> device_id);
ALTER TABLE assignments ADD CONSTRAINT assignments_zone
  FOREIGN KEY (tenant_id, zone_key) REFERENCES screen_zones (tenant_id, key);
ALTER TABLE assignments ADD CONSTRAINT assignments_mirror_zone
  FOREIGN KEY (tenant_id, mirror_zone_key) REFERENCES screen_zones (tenant_id, key);
ALTER TABLE assignments ADD CONSTRAINT assignments_mirror_device
  FOREIGN KEY (tenant_id, mirror_device_id) REFERENCES assignments (tenant_id, device_id);
CREATE INDEX assignments_zone ON assignments (tenant_id, zone_key);
CREATE INDEX assignments_mirror_zone ON assignments (tenant_id, mirror_zone_key);
CREATE INDEX assignments_mirror_device ON assignments (tenant_id, mirror_device_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON screen_zones, screen_zone_seeds TO canccu_screen_app;
