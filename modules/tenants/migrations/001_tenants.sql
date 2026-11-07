-- The tenants module's tables (contracts/tenants.md, Tables). Run at every start under an
-- advisory lock, so every statement is idempotent.
--
-- Global tables are on scripts/tenancy-global-tables.txt; every other table is per tenant under
-- RLS. Requests run as canccu_tenants_app (SET LOCAL ROLE), which RLS binds; the login role only
-- runs this file.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'canccu_tenants_app') THEN
    CREATE ROLE canccu_tenants_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS venues (
  id text PRIMARY KEY,
  name text NOT NULL,
  addresses text[] NOT NULL DEFAULT '{}',
  house_rules text NOT NULL DEFAULT '',
  wifi jsonb NOT NULL DEFAULT '[]',
  floor_plan_type text,
  floor_plan_updated_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- series_id stays a plain value until the series table lands with #150.
CREATE TABLE IF NOT EXISTS tenants (
  id text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'archived')),
  time_zone text NOT NULL,
  starts_at timestamptz,
  ends_at timestamptz,
  venue_id text REFERENCES venues (id),
  series_id text,
  info_page_mode text NOT NULL DEFAULT 'public',
  membership text NOT NULL DEFAULT 'open',
  admin_access text NOT NULL DEFAULT 'restricted',
  ip_check_disabled_until timestamptz,
  ip_check_reason text,
  archived_at timestamptz,
  presence_delete_at timestamptz,
  cloned_from text,
  flags_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1
);

-- tenant_id is plain text, not a foreign key: a held row outlives its deleted tenant.
CREATE TABLE IF NOT EXISTS hostnames (
  hostname text PRIMARY KEY,
  tenant_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('platform', 'custom')),
  status text NOT NULL CHECK (status IN ('pending', 'active', 'held')),
  is_primary boolean NOT NULL DEFAULT false,
  verify_token text,
  held_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS hostnames_one_primary ON hostnames (tenant_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  discord_id text NOT NULL UNIQUE,
  name text NOT NULL,
  mfa_enabled boolean NOT NULL DEFAULT false,
  superadmin boolean NOT NULL DEFAULT false,
  audit_ref text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_audit (
  id text PRIMARY KEY,
  time timestamptz NOT NULL DEFAULT now(),
  actor jsonb NOT NULL,
  action text NOT NULL,
  target jsonb NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}',
  reason text,
  correlation_id text
);

CREATE TABLE IF NOT EXISTS event_admins (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), '') REFERENCES tenants (id),
  user_id text NOT NULL REFERENCES users (id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS tenant_flags (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), '') REFERENCES tenants (id),
  name text NOT NULL,
  value boolean NOT NULL,
  PRIMARY KEY (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS venue_info (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), '') REFERENCES tenants (id),
  venue_id text,
  copied_at timestamptz,
  house_rules text NOT NULL DEFAULT '',
  wifi jsonb NOT NULL DEFAULT '[]',
  floor_plan_type text,
  floor_plan_updated_at timestamptz,
  revision integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id)
);

CREATE TABLE IF NOT EXISTS audit (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), '') REFERENCES tenants (id),
  id text NOT NULL,
  time timestamptz NOT NULL DEFAULT now(),
  actor jsonb NOT NULL,
  action text NOT NULL,
  target jsonb NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}',
  reason text,
  correlation_id text,
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE event_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_admins FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS canccu_tenant ON event_admins;
CREATE POLICY canccu_tenant ON event_admins USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE tenant_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_flags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS canccu_tenant ON tenant_flags;
CREATE POLICY canccu_tenant ON tenant_flags USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE venue_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_info FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS canccu_tenant ON venue_info;
CREATE POLICY canccu_tenant ON venue_info USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS canccu_tenant ON audit;
CREATE POLICY canccu_tenant ON audit USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON venues, tenants, hostnames, users, event_admins, tenant_flags, venue_info TO canccu_tenants_app;
-- The audit log is append-only by grant (contracts/tenants.md, Audit log), not only by code.
GRANT SELECT, INSERT ON audit, platform_audit TO canccu_tenants_app;
