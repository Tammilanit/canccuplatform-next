-- The notify module's first tables (contracts/notify.md): the global topic registry and its
-- history, each event's topic configuration, notifications and their dedupe keys. Runs once:
-- db.py records it in notify_migrations. Requests run as canccu_notify_app (SET LOCAL ROLE).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'canccu_notify_app') THEN
    CREATE ROLE canccu_notify_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- Global: one set of topic types for the platform (contracts/notify.md, Tenancy).
CREATE TABLE IF NOT EXISTS notify_topic_types (
  key text PRIMARY KEY,
  owner text NOT NULL,
  registration jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Global and append-only: the app role may insert and read, never change or delete (the grants
-- below), so the history of who registered what cannot be rewritten by the module itself.
CREATE TABLE IF NOT EXISTS notify_topic_type_history (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  owner text NOT NULL,
  old jsonb,
  new jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- No row means config_version 0 and the defaults; NULL columns fall back to the settings and the
-- type (README, Configuration).
CREATE TABLE IF NOT EXISTS notify_topic_config (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  key text NOT NULL,
  enabled boolean,
  params jsonb NOT NULL DEFAULT '{}',
  channels text[],
  config_version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, key)
);

-- A personal notification has one user; an event-wide one has none. The id is random (secrets),
-- never a sequence: holding it is what lets a guest read a public one.
CREATE TABLE IF NOT EXISTS notify_notifications (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  topic text NOT NULL,
  part text NOT NULL CHECK (part IN ('event', 'personal')),
  audience text NOT NULL CHECK (audience IN ('public', 'attendees', 'personal')),
  user_id text,
  title text NOT NULL,
  body text NOT NULL,
  url text,
  urgent boolean NOT NULL DEFAULT false,
  channels text[] NOT NULL,
  entity_type text,
  entity_id text,
  source_event_id text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK ((audience = 'personal') = (user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS notify_notifications_inbox
  ON notify_notifications (tenant_id, expires_at, created_at);

-- Events arrive at least once: the first insert of a key wins (contracts/notify.md, Dedupe).
CREATE TABLE IF NOT EXISTS notify_dedupe (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

-- The event's time zone as the tenants module last told a request: the stream consumer has no
-- request, and templates format times in the event's zone (README, Time zones).
CREATE TABLE IF NOT EXISTS notify_event_state (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  time_zone text NOT NULL,
  PRIMARY KEY (tenant_id)
);

ALTER TABLE notify_event_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_event_state FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON notify_event_state USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE notify_topic_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_topic_config FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON notify_topic_config USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE notify_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON notify_notifications USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE notify_dedupe ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_dedupe FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON notify_dedupe USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT USAGE ON SCHEMA public TO canccu_notify_app;
GRANT SELECT, INSERT, UPDATE ON notify_topic_types TO canccu_notify_app;
GRANT SELECT, INSERT ON notify_topic_type_history TO canccu_notify_app;
GRANT USAGE ON SEQUENCE notify_topic_type_history_id_seq TO canccu_notify_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON notify_topic_config, notify_notifications, notify_dedupe,
  notify_event_state
  TO canccu_notify_app;
