-- The outbox for screen's bus events (#545), first for `screen.pin.changed`. Additive: two new
-- tables, as the kit's Outbox needs them (packages/kit-ts/src/outbox.ts).

-- A write stores its events here in its own transaction; the outbox sends them after the commit
-- and deletes them.
CREATE TABLE screen_outbox (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  event text NOT NULL,
  PRIMARY KEY (tenant_id, seq)
);

ALTER TABLE screen_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_outbox USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

-- Global: the events with pending rows, so the sender finds them without a tenant set.
CREATE TABLE screen_outbox_tenants (
  tenant_id text PRIMARY KEY
);

GRANT SELECT, INSERT, DELETE ON screen_outbox TO canccu_screen_app;
-- UPDATE only because the kit's row locks need it; nothing updates a row.
GRANT SELECT, INSERT, UPDATE, DELETE ON screen_outbox_tenants TO canccu_screen_app;
