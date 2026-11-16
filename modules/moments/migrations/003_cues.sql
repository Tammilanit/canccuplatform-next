-- Cues and sound (#113; contracts/moments.md, Cues and sound). Additive. The flood and budget
-- counters are in Valkey (D15); everything else is per event under RLS, as in 001.

-- A moment's picture: the effect its cue picked, sent on its overrides as `effect`.
ALTER TABLE moments ADD COLUMN effect jsonb;

-- The event's sound settings (master, mute, limits, categories); no row: the defaults.
CREATE TABLE moments_sound_settings (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  settings jsonb NOT NULL,
  revision integer NOT NULL,
  PRIMARY KEY (tenant_id)
);

-- The cues: a built-in's row overrides its seed field by field; an event's own cue is a row only.
CREATE TABLE moments_cues (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  name text NOT NULL,
  settings jsonb NOT NULL,
  revision integer NOT NULL,
  -- The effect it picked last, never picked twice running (L7).
  last_effect text,
  PRIMARY KEY (tenant_id, name)
);

-- The event's uploads, linked from Screen's `audio` assets; the default pack is in the code.
CREATE TABLE moments_sounds (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  asset_id text NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  length_ms integer NOT NULL,
  size_bytes integer NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX moments_sounds_asset ON moments_sounds (tenant_id, asset_id);

-- Each zone's sound state: what plays until when, the short queue, cooldowns, the last pick.
-- Locked FOR UPDATE per decision, so every container decides a zone's sounds one at a time.
CREATE TABLE moments_sound_zones (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  zone_key text NOT NULL,
  state jsonb NOT NULL,
  PRIMARY KEY (tenant_id, zone_key)
);

-- Once per source (7 days), for the cues flagged so.
CREATE TABLE moments_sound_sources (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  zone_key text NOT NULL,
  cue text NOT NULL,
  source text NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, zone_key, cue, source)
);

-- The sound log: every decision with its reason code (E12, E13, E14).
CREATE TABLE moments_sound_log (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  at timestamptz NOT NULL,
  zone_key text NOT NULL,
  cue text NOT NULL,
  sound text,
  outcome text NOT NULL,
  reason text NOT NULL,
  detail text,
  source text,
  PRIMARY KEY (tenant_id, seq)
);
CREATE INDEX moments_sound_log_zone ON moments_sound_log (tenant_id, zone_key, seq);

ALTER TABLE moments_sound_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_sound_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_sound_settings USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_cues ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_cues FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_cues USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_sounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_sounds FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_sounds USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_sound_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_sound_zones FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_sound_zones USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_sound_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_sound_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_sound_sources USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_sound_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_sound_log FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_sound_log USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON moments_sound_settings, moments_cues, moments_sounds, moments_sound_zones, moments_sound_sources, moments_sound_log TO canccu_moments_app;
