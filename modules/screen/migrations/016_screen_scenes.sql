-- Screen's copy of each zone's scene from moments.scene.changed (contracts/screen.md, Motion and
-- burn-in drift; D5). Additive. `scene` is null while no scene holds: the day's phase then. Kept
-- after Moments stops, so a screen keeps the last scene it was told; `event_id` is the newest event
-- applied (UUID v7 sorts by time), so a replay from the stream's start changes nothing.
CREATE TABLE screen_scenes (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  zone_key text NOT NULL,
  scene jsonb,
  event_id text COLLATE "C" NOT NULL,
  PRIMARY KEY (tenant_id, zone_key)
);

ALTER TABLE screen_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_scenes FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_scenes USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON screen_scenes TO canccu_screen_app;
