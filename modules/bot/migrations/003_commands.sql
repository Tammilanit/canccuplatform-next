-- Additive (step 6, link 3: the command framework; contracts/bot.md, The command framework).
--
-- The hash of the command set last written to the guild (O4): a deploy or a flag change that
-- leaves a guild's set as it was writes nothing, so many guilds stay within Discord's daily limit
-- on command writes.
ALTER TABLE bot_bindings ADD COLUMN IF NOT EXISTS commands_hash text;

-- An outside provider's bearer secret per event (contracts/bot.md, Provider secrets), sealed with
-- the kit's SecretBox and bound to the event and the provider (aad bot:provider:<tenant>:
-- <provider>), so a value copied to another row does not open. Who set it is in the audit log.
CREATE TABLE IF NOT EXISTS bot_provider_secrets (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  provider text NOT NULL,
  secret text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, provider)
);
ALTER TABLE bot_provider_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_provider_secrets FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON bot_provider_secrets
  USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON bot_provider_secrets TO canccu_bot_app;
