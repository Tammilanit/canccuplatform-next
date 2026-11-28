-- Additive (step 6, #125: the legacy bot import, D9 and D10 of the step 6 plan).
--
-- What the import brings from the legacy bot that has no other home yet, kept for the event as
-- the legacy files held it: the finals state (its two state files and the finals channels),
-- which the Finals module takes once it exists (D9), and the two settings, which the report maps
-- for the operator. Keyed by the legacy names (a file name or an env key), so a second run of the
-- import finds every row and changes nothing.
CREATE TABLE IF NOT EXISTS bot_legacy (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  kind text NOT NULL CHECK (kind IN ('finals', 'setting')),
  key text NOT NULL,
  value jsonb NOT NULL,
  imported_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, kind, key)
);
ALTER TABLE bot_legacy ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_legacy FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON bot_legacy
  USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON bot_legacy TO canccu_bot_app;
