-- The Notifications page's health box (#782 part C, plan D15). Additive: two nullable columns.

-- What kind of device a subscription is, read once from the User-Agent at subscribe; the
-- User-Agent itself is never stored. NULL for subscriptions made before this column.
ALTER TABLE notify_subscriptions ADD COLUMN IF NOT EXISTS device text
  CHECK (device IN ('phone', 'pc'));

-- Why a push failed, in words ("the push service refused it (403)"), for the last delivery.
ALTER TABLE notify_deliveries ADD COLUMN IF NOT EXISTS error text
  CHECK (char_length(error) <= 200);

-- When the event's last crew test went out: one a minute (crew_test.py, plan D16).
ALTER TABLE notify_source_state ADD COLUMN IF NOT EXISTS crew_test_at timestamptz;
