-- The outbox for Notify's bus events (#288) and the re-seal of check-in keys (#289).
-- Additive: two new tables and one grant.

-- A write stores its events here in its own transaction; the kit's Outbox sends them after the
-- commit and deletes them (packages/kit-py/src/canccu_kit/outbox.py).
CREATE TABLE IF NOT EXISTS notify_outbox (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  event text NOT NULL,
  PRIMARY KEY (tenant_id, seq)
);

ALTER TABLE notify_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON notify_outbox USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

-- Global: the events with pending rows, so the sender finds them without a tenant set.
CREATE TABLE IF NOT EXISTS notify_outbox_tenants (
  tenant_id text PRIMARY KEY
);

GRANT SELECT, INSERT, DELETE ON notify_outbox TO canccu_notify_app;
-- UPDATE only because the kit's row locks need it; nothing updates a row.
GRANT SELECT, INSERT, UPDATE, DELETE ON notify_outbox_tenants TO canccu_notify_app;

-- A key sealed with a retired secrets key is sealed again with the current one on read.
GRANT UPDATE (sealed) ON notify_check_in_keys TO canccu_notify_app;
