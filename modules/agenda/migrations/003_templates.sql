-- The run-of-show pages' templates (#211, plan issue-187 D11): page data for quick-add, not part
-- of the agenda API, so the contract stays as it is. Additive only.

-- Set once the event's starter templates are made, so an organiser who removes them all does not
-- get them back.
ALTER TABLE agenda_state ADD COLUMN IF NOT EXISTS templates_seeded boolean NOT NULL DEFAULT false;

-- `minutes` is the default length; null makes a moment in time (no end).
CREATE TABLE IF NOT EXISTS agenda_templates (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  minutes integer CHECK (minutes IS NULL OR minutes BETWEEN 1 AND 1440),
  location text,
  zone text,
  visibility text NOT NULL CHECK (visibility IN ('public', 'attendees', 'crew')),
  reminder_leads_minutes integer[],
  notify text[],
  position serial,
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE agenda_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON agenda_templates USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON agenda_templates TO canccu_agenda_app;
GRANT USAGE ON SEQUENCE agenda_templates_position_seq TO canccu_agenda_app;
