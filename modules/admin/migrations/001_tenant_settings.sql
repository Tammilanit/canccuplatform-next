-- Admin's per-tenant tables: each event's module settings and its profile record
-- (contracts/admin.md, Settings and Profile; 0013 item 18). Runs once: db.py records it in
-- admin_migrations.
--
-- They replace the single-event admin_settings and admin_profile, which this file leaves as they
-- are (expand and contract, 0013 item 22): nothing reads them any more, and dropping them is a
-- destructive migration of its own. Their rows are not copied, because they belong to no tenant;
-- loading the event's profile again restores its settings.
--
-- Requests run as canccu_admin_app (SET LOCAL ROLE), which RLS binds; the login role only runs
-- this file.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'canccu_admin_app') THEN
    CREATE ROLE canccu_admin_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS admin_tenant_settings (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  module text NOT NULL,
  settings_version integer NOT NULL CHECK (settings_version > 0),
  values jsonb NOT NULL,
  PRIMARY KEY (tenant_id, module)
);
ALTER TABLE admin_tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_tenant_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON admin_tenant_settings
  USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

-- One profile record per tenant: the tenant id is the whole key.
CREATE TABLE IF NOT EXISTS admin_tenant_profile (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  document jsonb NOT NULL,
  PRIMARY KEY (tenant_id)
);
ALTER TABLE admin_tenant_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_tenant_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON admin_tenant_profile
  USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

-- Explicit: a public schema created by hand (not by initdb) grants no USAGE to PUBLIC.
GRANT USAGE ON SCHEMA public TO canccu_admin_app;
-- No DELETE yet: nothing deletes a tenant's settings until admin follows tenants.tenant.deleted.
GRANT SELECT, INSERT, UPDATE ON admin_tenant_settings, admin_tenant_profile TO canccu_admin_app;
