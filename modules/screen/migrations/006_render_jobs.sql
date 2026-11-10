-- Render jobs for PPTX and PDF decks (contracts/screen.md, The PPTX render job; #224). Additive:
-- one new per-tenant table. The rows are the truth; the fair queue in Valkey only orders them and
-- is rebuilt from the queued and running rows.
CREATE TABLE screen_render_jobs (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  asset_id text NOT NULL,
  asset_version integer NOT NULL,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  -- How often a container started it: a job whose container was lost runs once more, then fails
  -- (plan #184, R11). It also tells a container whether the running job is still its own.
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  submitted_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  -- A succeeded job is the version's render: its slides (`index`, `width`, `height`, `bytes`)
  -- under /files/<tenant>/screen/renders/<asset id>/<asset version>/, the warnings, and the bytes
  -- the slides count against the storage quota.
  slides jsonb,
  warnings jsonb,
  bytes bigint NOT NULL DEFAULT 0,
  -- The bytes the running attempt has reserved for slides it wrote to tmp/render-<id>-<attempts>:
  -- whoever ends the attempt (its container, or the lease sweep after a lost one) gives them back.
  reserved_bytes bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id),
  -- No cascade: a version's jobs and render are removed by the code that removes the version, so
  -- their files and quota go with them (src/render/jobs.ts, dropJobs).
  FOREIGN KEY (tenant_id, asset_id, asset_version)
    REFERENCES screen_asset_versions (tenant_id, asset_id, version)
);
-- One live job per asset version, and one render.
CREATE UNIQUE INDEX screen_render_jobs_live ON screen_render_jobs (tenant_id, asset_id, asset_version)
  WHERE state IN ('queued', 'running');
CREATE UNIQUE INDEX screen_render_jobs_render ON screen_render_jobs (tenant_id, asset_id, asset_version)
  WHERE state = 'succeeded';
CREATE INDEX screen_render_jobs_asset ON screen_render_jobs (tenant_id, asset_id, submitted_at DESC);
CREATE INDEX screen_render_jobs_waiting ON screen_render_jobs (tenant_id, submitted_at)
  WHERE state IN ('queued', 'running');

ALTER TABLE screen_render_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_render_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_render_jobs USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON screen_render_jobs TO canccu_screen_app;
