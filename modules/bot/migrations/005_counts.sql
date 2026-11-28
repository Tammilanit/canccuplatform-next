-- Additive (step 6, #849: counts and chat activity; contracts/bot.md, Counts).
--
-- Counts, never people (D7): no Discord id, user id, name, channel or message text in any of
-- these. A count is null when its feed's flag was off, or for a minute only its messages
-- survived (the bot was down). Minute rows are working data, folded per hour and kept 48 hours;
-- hour rows stay with the event, anonymous, until the event is deleted.
CREATE TABLE IF NOT EXISTS bot_counts_minute (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  minute timestamptz NOT NULL,
  members integer,
  online integer,
  idle integer,
  dnd integer,
  in_voice integer,
  messages integer,
  -- [{application_id, name, players}]: game names as members' activities carry them.
  activities jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, minute)
);

CREATE TABLE IF NOT EXISTS bot_counts_hour (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  hour timestamptz NOT NULL,
  minutes integer NOT NULL,
  members numeric(10, 2),
  online numeric(10, 2),
  online_max integer,
  idle numeric(10, 2),
  dnd numeric(10, 2),
  in_voice numeric(10, 2),
  in_voice_max integer,
  messages integer,
  PRIMARY KEY (tenant_id, hour)
);

CREATE TABLE IF NOT EXISTS bot_activity_hour (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  hour timestamptz NOT NULL,
  name text NOT NULL,
  application_id text,
  player_minutes integer NOT NULL,
  peak_players integer NOT NULL,
  PRIMARY KEY (tenant_id, hour, name)
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

GRANT SELECT, INSERT, DELETE ON bot_counts_minute, bot_counts_hour, bot_activity_hour
  TO canccu_bot_app;
