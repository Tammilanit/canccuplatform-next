-- Assets and their files (contracts/screen.md, Content and scheduling; #217). Additive: three new
-- per-tenant tables.

-- One row per stored file of the event, named by its content (`<sha256>.<ext>`), so identical
-- bytes are kept and counted against the quota once. A row lives exactly as long as something
-- refers to it (an asset version here; renders, photos and claim sounds when they come), and the
-- file on disk goes with its row (src/assets/files.ts).
CREATE TABLE screen_files (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  name text NOT NULL CHECK (name ~ '^[a-f0-9]{64}\.[a-z0-9]{1,8}$'),
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, name)
);

CREATE TABLE screen_assets (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'pptx', 'pdf', 'web', 'youtube')),
  title text NOT NULL,
  -- The version shown, and the one a revert goes back to (null: nothing to revert).
  version integer NOT NULL DEFAULT 1,
  prev_version integer,
  -- The highest version ever given, so a number is never reused: renders are addressed by it.
  last_version integer NOT NULL DEFAULT 1,
  -- The embed or page a web or YouTube asset shows; null for files.
  url text,
  health text NOT NULL DEFAULT 'ok' CHECK (health IN ('ok', 'degraded', 'error')),
  health_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CHECK ((kind IN ('web', 'youtube')) = (url IS NOT NULL))
);
CREATE INDEX screen_assets_newest ON screen_assets (tenant_id, created_at DESC, id DESC);

-- A file asset's versions: the current one and at most one kept for undo.
CREATE TABLE screen_asset_versions (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  asset_id text NOT NULL,
  version integer NOT NULL,
  file text NOT NULL,
  original_name text NOT NULL,
  duration_seconds double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, asset_id, version),
  FOREIGN KEY (tenant_id, asset_id) REFERENCES screen_assets (tenant_id, id),
  FOREIGN KEY (tenant_id, file) REFERENCES screen_files (tenant_id, name)
);
CREATE INDEX screen_asset_versions_file ON screen_asset_versions (tenant_id, file);

ALTER TABLE screen_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_files FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_files USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));
ALTER TABLE screen_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_assets USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));
ALTER TABLE screen_asset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_asset_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_asset_versions USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON screen_files, screen_assets, screen_asset_versions TO canccu_screen_app;
