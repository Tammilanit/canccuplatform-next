-- The outbox for the bot's own events (contracts/bot.md, Events): a write stores them in its own
-- transaction and the kit's Outbox sends them after the commit. Additive: two new tables.
CREATE TABLE IF NOT EXISTS bot_outbox (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  event text NOT NULL,
  PRIMARY KEY (tenant_id, seq)
);

ALTER TABLE bot_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON bot_outbox
  USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

-- Global: the events with pending rows, so the sender finds them without a tenant set.
CREATE TABLE IF NOT EXISTS bot_outbox_tenants (
  tenant_id text PRIMARY KEY
);

GRANT SELECT, INSERT, DELETE ON bot_outbox TO canccu_bot_app;
-- UPDATE only because the kit's row locks need it; nothing updates a row.
GRANT SELECT, INSERT, UPDATE, DELETE ON bot_outbox_tenants TO canccu_bot_app;
