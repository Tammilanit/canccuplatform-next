-- Live editing (#210): pending timers, the events that have any, and the tournament-session
-- marks (contracts/agenda.md, Reminders and Tournament sessions). Additive only.

-- One row per pending reminder, start or end of an item, rewritten from the item on every change
-- (timers.py). Rows, not in-memory timers: containers keep no state and may run more than once.
CREATE TABLE IF NOT EXISTS agenda_timers (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  item_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reminder', 'started', 'ended')),
  lead_minutes integer NOT NULL DEFAULT 0,
  due_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, item_id, kind, lead_minutes),
  FOREIGN KEY (tenant_id, item_id) REFERENCES agenda_items (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agenda_timers_due ON agenda_timers (tenant_id, due_at);

-- The events that have pending timers, so the scheduler finds them without a tenant set: RLS
-- hides agenda_timers outside a tenant's context. A plain tenant reference and nothing else.
CREATE TABLE IF NOT EXISTS agenda_timer_tenants (
  tenant_id text PRIMARY KEY
);

-- The newest session revision the mirror applied, and the tombstone of a removed session, kept
-- after its item is gone so a late or redelivered event never brings it back.
CREATE TABLE IF NOT EXISTS agenda_sessions (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  session_id text NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  removed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, session_id)
);

ALTER TABLE agenda_timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_timers FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON agenda_timers USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE agenda_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON agenda_sessions USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON agenda_timers, agenda_sessions TO canccu_agenda_app;
GRANT SELECT, INSERT, DELETE ON agenda_timer_tenants TO canccu_agenda_app;
