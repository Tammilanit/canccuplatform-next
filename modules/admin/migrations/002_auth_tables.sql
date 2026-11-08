-- Admin's sign-in tables (users, roles, sessions, OAuth flows, the first-run code), until now
-- created by auth_db.py at every start. Modules now log in as a plain role that may not create
-- tables (0013 item 5), so the migration role creates them. IF NOT EXISTS: a stack that ran
-- before this file already has them, and roles.sql has made the migration role their owner.
--
-- Global tables (scripts/tenancy-global-tables.txt): sign-in is not per tenant until the
-- central sign-in host (#52).

CREATE TABLE IF NOT EXISTS admin_users (
  id text PRIMARY KEY,
  discord_id text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_roles (
  user_id text PRIMARY KEY REFERENCES admin_users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin')),
  granted_at timestamptz NOT NULL,
  granted_by text
);
-- At most one owner, so two concurrent first-run claims cannot both win.
CREATE UNIQUE INDEX IF NOT EXISTS admin_roles_one_owner ON admin_roles ((true))
  WHERE role = 'owner';
CREATE TABLE IF NOT EXISTS admin_sessions (
  id_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sign_in_flows (
  state_hash text PRIMARY KEY,
  nonce_hash text NOT NULL,
  verifier text NOT NULL,
  claim_hash text,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_first_run (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by text REFERENCES admin_users (id) ON DELETE SET NULL
);

-- The login role reaches them through canccu_admin_app, the same grant as the tenant tables.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON admin_users, admin_roles, admin_sessions, admin_sign_in_flows, admin_first_run
  TO canccu_admin_app;
