-- People (#437): the Discord handle beside the name, when each person was last here, and when the
-- owner removed them. Additive. A removed person keeps their row, so the history of what they
-- changed still names them; signing in again clears removed_at.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS handle text;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS removed_at timestamptz;
