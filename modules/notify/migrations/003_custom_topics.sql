-- Each event's own topics (contracts/notify.md, Custom topics). Numbered 003 so it sorts after
-- the 002 migrations of the push and check-in packages, whichever merges first.
-- notify_topic_config.enabled, enabled_seen and lead_seen are no longer read (#251: admin's
-- settings own those values); a config write clears them, and dropping them is a later,
-- destructive migration.

-- A custom topic stores only what narrows its base; its registration is derived from the base on
-- every read, so a new version of the base module reaches the custom topic at once.
CREATE TABLE IF NOT EXISTS notify_custom_topics (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  key text NOT NULL CHECK (key LIKE 'custom\_%'),
  based_on text NOT NULL,
  title text NOT NULL,
  description text,
  defaults jsonb NOT NULL DEFAULT '{}',
  conditions jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, key)
);

-- The base a custom topic's notification came from: a recipient who gets both gets only the
-- custom one (Custom topics), and the custom topic may be gone by the time anyone reads it.
ALTER TABLE notify_notifications ADD COLUMN IF NOT EXISTS based_on text;

ALTER TABLE notify_custom_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_custom_topics FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON notify_custom_topics USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON notify_custom_topics TO canccu_notify_app;
