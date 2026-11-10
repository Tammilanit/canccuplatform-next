-- The outbox for the agenda's bus events (#288). Additive: two new tables.

-- A write stores its events here in its own transaction; the kit's Outbox sends them after the
-- commit and deletes them (packages/kit-py/src/canccu_kit/outbox.py).
CREATE TABLE IF NOT EXISTS agenda_outbox (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  event text NOT NULL,
  PRIMARY KEY (tenant_id, seq)
);

ALTER TABLE agenda_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON agenda_outbox USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

-- Global: the events with pending rows, so the sender finds them without a tenant set.
CREATE TABLE IF NOT EXISTS agenda_outbox_tenants (
  tenant_id text PRIMARY KEY
);

GRANT SELECT, INSERT, DELETE ON agenda_outbox TO canccu_agenda_app;
-- UPDATE only because the kit's row locks need it; nothing updates a row.
GRANT SELECT, INSERT, UPDATE, DELETE ON agenda_outbox_tenants TO canccu_agenda_app;
