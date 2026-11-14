-- The run of show's last post in the event's Discord channel, for the line under the miniature
-- (#433, docs/design/mockups.html sheet 5). Page data, not part of the agenda API. Additive: one
-- new table, one row per event, written in the transaction of the change that asks for the post.
CREATE TABLE IF NOT EXISTS agenda_last_post (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  event_type text NOT NULL,
  data jsonb NOT NULL,
  -- One post for a delay with its following items: only the first event of a correlation counts.
  correlation_id text,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id)
);

ALTER TABLE agenda_last_post ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_last_post FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON agenda_last_post USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE ON agenda_last_post TO canccu_agenda_app;
