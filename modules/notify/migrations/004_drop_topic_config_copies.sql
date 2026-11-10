-- Destructive (#293): admin's settings `topics` and `schedule_lead_minutes` own `enabled` and the
-- schedule lead since #251, and nothing has read these copies since, so dropping them loses
-- nothing in use.
ALTER TABLE notify_topic_config DROP COLUMN IF EXISTS enabled;
ALTER TABLE notify_topic_config DROP COLUMN IF EXISTS enabled_seen;
ALTER TABLE notify_topic_config DROP COLUMN IF EXISTS lead_seen;
