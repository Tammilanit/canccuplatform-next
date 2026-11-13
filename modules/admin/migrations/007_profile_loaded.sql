-- Additive: when the event's profile was last loaded and by whom, for the Event profile page's
-- "Loaded" summary (docs/design/mockups.html, sheet 4). Null until the next load; the row stays
-- bound by its RLS policy and the app role's grants on the table.
ALTER TABLE admin_tenant_profile ADD COLUMN IF NOT EXISTS loaded_at timestamptz;
ALTER TABLE admin_tenant_profile ADD COLUMN IF NOT EXISTS loaded_by text;
