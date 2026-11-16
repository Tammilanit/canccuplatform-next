-- Scenes (contracts/moments.md, Scenes): the event's list, each zone's scene as last sent, the
-- crew button, and the arrival check-ins of the last hour that the conditions and the heartbeat
-- read. Additive: new tables only.

-- The event's scenes in priority order, copied from the presets on first use (O7).
CREATE TABLE moments_scenes (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  scenes jsonb NOT NULL,
  revision integer NOT NULL,
  PRIMARY KEY (tenant_id)
);

-- Each zone's scene as last sent in moments.scene.changed, so a change sends only what changed
-- and a restart holds a scene for the rest of its hold time.
CREATE TABLE moments_scene_zones (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  zone_key text NOT NULL,
  scene_key text,
  since timestamptz NOT NULL,
  why text NOT NULL,
  sent jsonb NOT NULL,
  PRIMARY KEY (tenant_id, zone_key)
);

-- The crew button pressed now, one per event: it wins until `until` or a second press (E7).
CREATE TABLE moments_scene_crew (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  scene_key text NOT NULL,
  zones text[] NOT NULL,
  until timestamptz NOT NULL,
  actor_user_id text,
  PRIMARY KEY (tenant_id)
);

-- Arrival check-ins by id (events come at least once) and time only: a count names nobody.
CREATE TABLE moments_checkins (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  check_in_id text NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, check_in_id)
);
CREATE INDEX moments_checkins_at ON moments_checkins (tenant_id, at);

ALTER TABLE moments_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_scenes FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_scenes USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_scene_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_scene_zones FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_scene_zones USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_scene_crew ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_scene_crew FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_scene_crew USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_checkins FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_checkins USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON moments_scenes, moments_scene_zones, moments_scene_crew, moments_checkins TO canccu_moments_app;
