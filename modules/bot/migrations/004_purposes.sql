-- Additive (step 6, link 5: purposes and the setup check; contracts/bot.md, Purposes).
--
-- Which channel or role of the event's guild serves each purpose. Only the id is kept: the name,
-- and whether it still exists, are read live from Discord, so a channel deleted there shows
-- `missing` (E3) without anything here going stale. The rows belong to the binding: an unbind
-- deletes them and a clone moves them with it. Who set one is in the audit log.
CREATE TABLE IF NOT EXISTS bot_purposes (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  purpose text NOT NULL,
  target_id text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, purpose)
);
ALTER TABLE bot_purposes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_purposes FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON bot_purposes
  USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON bot_purposes TO canccu_bot_app;
