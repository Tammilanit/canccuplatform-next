-- Additive (step 6, #122 link 3: the commands and the announcement post; contracts/bot.md, Posts).
--
-- The bot's message for each announcement in the guild's `announcements` channel, so
-- `moments.announcement.changed` edits it and `.withdrawn` marks it (L4, L5). Every container reads
-- every event: the row is claimed before the post goes out, so one container posts and the others
-- find it taken. `message_id` is null while the post is on its way. The rows belong to the binding:
-- an unbind, a clone that moves it and a deleted event delete them. `kind` is `announcement`; the
-- living messages of link 4 share the table (D6 of docs/plans/issue-122.md).
CREATE TABLE IF NOT EXISTS bot_posts (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  kind text NOT NULL,
  key text NOT NULL,
  channel_id text NOT NULL,
  message_id text,
  title text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, kind, key)
);
ALTER TABLE bot_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_posts FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON bot_posts
  USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON bot_posts TO canccu_bot_app;
