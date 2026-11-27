-- The bot module's tables (contracts/bot.md, Tables: global and per tenant). Runs once: db.py
-- records it in bot_migrations. Connections and bindings are per tenant under RLS; the two route
-- tables are global (scripts/tenancy-global-tables.txt): they are read before a tenant is set,
-- to route a gateway event to its event and to find the own applications to open.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'canccu_bot_app') THEN
    CREATE ROLE canccu_bot_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- No row is the default: the shared bot, revision 0. The credentials are sealed with the kit's
-- SecretBox, bound to the tenant and the application (aad bot:token:<tenant>:<application id>,
-- bot:secret:…), so a value copied to another row does not open.
CREATE TABLE IF NOT EXISTS bot_connections (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  mode text NOT NULL DEFAULT 'shared' CHECK (mode IN ('shared', 'own')),
  application_id text,
  bot_token text,
  client_secret text,
  key_version integer,
  updated_at timestamptz,
  updated_by text,
  revision integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id),
  CHECK ((mode = 'own') = (application_id IS NOT NULL)),
  CHECK (mode = 'own' OR (bot_token IS NULL AND client_secret IS NULL))
);

-- One binding per event: the key is the tenant alone, so of two binds racing for one event only
-- one can win (contracts/bot.md, Binding a guild).
CREATE TABLE IF NOT EXISTS bot_bindings (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  guild_id text NOT NULL,
  guild_name text NOT NULL,
  application_id text NOT NULL,
  bound_by text,
  bound_at timestamptz NOT NULL DEFAULT now(),
  commands_status text NOT NULL DEFAULT 'pending'
    CHECK (commands_status IN ('registered', 'pending', 'failed', 'removed')),
  commands_flags_version integer,
  commands_registered_at timestamptz,
  commands_error_code text,
  PRIMARY KEY (tenant_id)
);

-- One route per guild: of two binds racing for one guild only one can win. A plain tenant
-- reference, nothing else (0013 item 6).
CREATE TABLE IF NOT EXISTS bot_guild_routes (
  guild_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  application_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS bot_guild_routes_application ON bot_guild_routes (application_id);

-- Keeps each own application to one event.
CREATE TABLE IF NOT EXISTS bot_application_routes (
  application_id text PRIMARY KEY,
  tenant_id text NOT NULL UNIQUE
);

ALTER TABLE bot_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON bot_connections
  USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE bot_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON bot_bindings
  USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT USAGE ON SCHEMA public TO canccu_bot_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON bot_connections, bot_bindings, bot_guild_routes, bot_application_routes TO canccu_bot_app;
