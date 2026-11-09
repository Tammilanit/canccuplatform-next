-- The agenda module's tables (contracts/agenda.md). Runs once: db.py records it in
-- agenda_migrations. Every table is per tenant under RLS; requests run as canccu_agenda_app
-- (SET LOCAL ROLE), which RLS binds.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'canccu_agenda_app') THEN
    CREATE ROLE canccu_agenda_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- One row per event: the two counters every change bumps. Taking it FOR UPDATE serialises the
-- event's writes, so agenda_version never skips or repeats (consumers re-read on a jump).
CREATE TABLE IF NOT EXISTS agenda_state (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  agenda_version integer NOT NULL DEFAULT 0,
  kinds_version integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id)
);

CREATE TABLE IF NOT EXISTS agenda_kinds (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  key text NOT NULL,
  name text NOT NULL,
  builtin boolean NOT NULL DEFAULT false,
  reminder_leads_minutes integer[],
  notify text[],
  revision integer NOT NULL DEFAULT 1,
  position serial,
  PRIMARY KEY (tenant_id, key)
);

-- The kind is not a foreign key: removing a kind checks its items in code (409 kind_in_use),
-- with the reason the contract gives.
CREATE TABLE IF NOT EXISTS agenda_items (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  title text NOT NULL,
  description text,
  kind text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  planned_starts_at timestamptz NOT NULL,
  planned_ends_at timestamptz,
  location text,
  zone text,
  visibility text NOT NULL CHECK (visibility IN ('public', 'attendees', 'crew')),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  reminder_leads_minutes integer[],
  notify text[],
  tournament_id text,
  tournament_session_id text,
  moment_id text,
  managed_by text,
  cloned_from text,
  revision integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS agenda_items_starts ON agenda_items (tenant_id, starts_at);
CREATE UNIQUE INDEX IF NOT EXISTS agenda_items_session
  ON agenda_items (tenant_id, tournament_session_id) WHERE tournament_session_id IS NOT NULL;

ALTER TABLE agenda_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_state FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON agenda_state USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE agenda_kinds ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_kinds FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON agenda_kinds USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE agenda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_items FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON agenda_items USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT USAGE ON SCHEMA public TO canccu_agenda_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON agenda_state, agenda_kinds, agenda_items TO canccu_agenda_app;
GRANT USAGE ON SEQUENCE agenda_kinds_position_seq TO canccu_agenda_app;
