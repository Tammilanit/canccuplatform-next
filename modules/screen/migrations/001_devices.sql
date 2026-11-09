-- The screen module's device tables (contracts/screen.md, Tenancy and Devices). Runs once:
-- kit-ts runMigrations records it in screen_migrations.
--
-- `devices` is the one global screen table (scripts/tenancy-global-tables.txt): device identity
-- only, never anything of an event (0013 item 34). Requests run as canccu_screen_app (SET LOCAL
-- ROLE), which RLS binds on the per-tenant tables.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'canccu_screen_app') THEN
    CREATE ROLE canccu_screen_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

CREATE TABLE devices (
  id text PRIMARY KEY,
  name text NOT NULL,
  -- SHA-256 of the current token; NULL until the paired kiosk collects its first token, so no
  -- token is ever stored, not even between the claim and the kiosk's next poll.
  token_hash text UNIQUE,
  -- [{"hash", "expires_at"}]: tokens a transfer replaced (contracts/screen.md, Moving).
  superseded_token_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  venue_id text,
  -- A plain reference: the tenants module owns tenants, and a parked device has none.
  current_tenant_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX devices_current_tenant ON devices (current_tenant_id);
CREATE INDEX devices_superseded ON devices USING gin (superseded_token_hashes jsonb_path_ops);

-- The device's place in one event: paired here, and later its zone or mirror target (#220).
CREATE TABLE assignments (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  device_id text NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  paired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, device_id)
);
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON assignments USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT USAGE ON SCHEMA public TO canccu_screen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON devices, assignments TO canccu_screen_app;
