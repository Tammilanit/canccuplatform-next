-- Additive: the acting tokens a command in Discord acts with (contracts/admin.md, The acting
-- token). Each is a minute long, for one person, one event and one module, and kept only as the
-- SHA-256 of its value, so a database dump acts for nobody.
--
-- Global, as admin_sessions is (scripts/tenancy-global-tables.txt): sign-in is not per tenant
-- until the central sign-in host (#52). The row names its tenant, and admin answers a token only
-- for that tenant.
CREATE TABLE IF NOT EXISTS admin_acting_tokens (
  token_hash text PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id text NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  module text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_acting_tokens_expiry ON admin_acting_tokens (expires_at);

GRANT SELECT, INSERT, DELETE ON admin_acting_tokens TO canccu_admin_app;
