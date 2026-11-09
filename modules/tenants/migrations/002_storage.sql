-- The storage quota (contracts/tenants.md, Storage quota): the event's quota on its registry
-- row, and one count of bytes per module of the event. Additive only.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS storage_quota_bytes bigint NOT NULL DEFAULT 2147483648
  CHECK (storage_quota_bytes BETWEEN 0 AND 1099511627776);

-- No row, or 0 bytes, means the module keeps no files of the event. The module name is checked
-- by the API, not here, so the count stays a plain number per name.
CREATE TABLE IF NOT EXISTS storage_counts (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), '') REFERENCES tenants (id),
  module text NOT NULL,
  bytes bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  PRIMARY KEY (tenant_id, module)
);

ALTER TABLE storage_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_counts FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON storage_counts USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE ON storage_counts TO canccu_tenants_app;
