-- Additive: one row per saved settings change, for the Settings page's "last changed" and "Last
-- changes" (docs/design/mockups.html, sheet 2). Per tenant and bound by RLS, as the settings are.
-- `changes` holds each changed key's new value (null when a key was cleared); the actor is the
-- user id that saved it, whose name admin_users holds.

CREATE TABLE IF NOT EXISTS admin_tenant_settings_changes (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id bigint GENERATED ALWAYS AS IDENTITY,
  module text NOT NULL,
  changes jsonb NOT NULL,
  actor_user_id text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS admin_tenant_settings_changes_recent
  ON admin_tenant_settings_changes (tenant_id, changed_at DESC);
ALTER TABLE admin_tenant_settings_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_tenant_settings_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON admin_tenant_settings_changes
  USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

-- A record of what happened: rows are added and read, never changed.
GRANT SELECT, INSERT ON admin_tenant_settings_changes TO canccu_admin_app;
