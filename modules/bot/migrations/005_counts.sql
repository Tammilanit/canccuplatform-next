-- Additive (step 6, #122 link 1: counts and chat activity; contracts/bot.md, Counts).
--
-- Counts, never people (D7): no user id, Discord id, name, channel or message text in any of these
-- tables. A minute row is what the bot counted in that minute (a count is null when its feed was
-- off or the client was away); its hour is folded into `bot_counts_hour` and
-- `bot_activity_hour` once the hour is over, and minute rows go three hours later. The counts stay
-- with the event, anonymous; they go only with the event itself.
CREATE TABLE IF NOT EXISTS bot_counts_minute (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  minute timestamptz NOT NULL,
  members integer,
  online integer,
  idle integer,
  dnd integer,
  in_voice integer,
  messages integer,
  -- [{application_id, name, players}]: an activity's name as Discord sends it, never who plays.
  activities jsonb,
  PRIMARY KEY (tenant_id, minute)
);

CREATE TABLE IF NOT EXISTS bot_counts_hour (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  hour timestamptz NOT NULL,
  minutes integer NOT NULL,
  members real,
  online real,
  idle real,
  dnd real,
  in_voice real,
  online_peak integer,
  in_voice_peak integer,
  messages integer,
  PRIMARY KEY (tenant_id, hour)
);

CREATE TABLE IF NOT EXISTS bot_activity_hour (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  hour timestamptz NOT NULL,
  activity_key text NOT NULL,
  application_id text,
  name text NOT NULL,
  player_minutes integer NOT NULL,
  PRIMARY KEY (tenant_id, hour, activity_key)
);

ALTER TABLE bot_counts_minute ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_counts_minute FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON bot_counts_minute
  USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE bot_counts_hour ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_counts_hour FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON bot_counts_hour
  USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE bot_activity_hour ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_activity_hour FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON bot_activity_hour
  USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON bot_counts_minute, bot_counts_hour, bot_activity_hour
  TO canccu_bot_app;
