-- Quiet hours, Discord DMs, each person's own choices and follows (#226; plan issue-188, areas
-- I and K). Additive: new tables and one new nullable column.

-- The event's `quiet_hours` items as the agenda last told Notify (contracts/notify.md, Quiet
-- hours): Notify times them itself, and a restart during quiet hours keeps them.
CREATE TABLE IF NOT EXISTS notify_quiet_hours (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  item_id text NOT NULL,
  visibility text NOT NULL,
  status text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, item_id)
);

-- What Notify last heard from other modules about the event: the agenda's version, to see a
-- jump, and the bot's guild binding and client status, which say whether a DM can go out.
CREATE TABLE IF NOT EXISTS notify_source_state (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  agenda_version integer,
  bot_bound boolean NOT NULL DEFAULT false,
  bot_client text,
  PRIMARY KEY (tenant_id)
);

-- Global: the events whose quiet hours Notify mirrors, so start-up reads each agenda again
-- without a tenant set. A plain tenant reference and nothing else.
CREATE TABLE IF NOT EXISTS notify_agenda_tenants (
  tenant_id text PRIMARY KEY
);

-- A person's own choices at one event. `channels` holds only what they set: a choice left out
-- takes the part's default, and only an explicit `discord_dm: false` stops the DM fallback.
CREATE TABLE IF NOT EXISTS notify_people (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  user_id text NOT NULL,
  dm_fallback boolean NOT NULL DEFAULT true,
  channels jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, user_id)
);

-- Only the id: the owner module is where the entity and its name live.
CREATE TABLE IF NOT EXISTS notify_follows (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  user_id text NOT NULL,
  topic text NOT NULL,
  entity_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, user_id, topic, entity_id)
);
CREATE INDEX IF NOT EXISTS notify_follows_entity ON notify_follows (tenant_id, topic, entity_id);

-- Why a Discord DM row exists (contracts/notify.md, Discord DMs); NULL on push rows.
ALTER TABLE notify_deliveries ADD COLUMN IF NOT EXISTS reason text
  CHECK (reason IN ('channel', 'fallback'));

ALTER TABLE notify_quiet_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_quiet_hours FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON notify_quiet_hours USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE notify_source_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_source_state FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON notify_source_state USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE notify_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_people FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON notify_people USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE notify_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_follows FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON notify_follows USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON notify_quiet_hours, notify_source_state, notify_people,
  notify_follows TO canccu_notify_app;
GRANT SELECT, INSERT, DELETE ON notify_agenda_tenants TO canccu_notify_app;
-- The archive deletes the event's check-in key with the rest (plan D5).
GRANT DELETE ON notify_check_in_keys TO canccu_notify_app;
