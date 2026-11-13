-- Keys to the draft for a preview on a screen (contracts/theming.md, Draft, preview, publish: On a
-- screen). Only a new table. The key itself is never stored: its SHA-256 is, so a database read
-- cannot hand anyone a working address. A key dies with the draft (drafts.ts removeDraft deletes
-- every row) and at `expires_at`.
CREATE TABLE theming_preview_keys (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  key_sha256 text NOT NULL CHECK (key_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key_sha256)
);

ALTER TABLE theming_preview_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE theming_preview_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON theming_preview_keys USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, DELETE ON theming_preview_keys TO canccu_theming_app;
