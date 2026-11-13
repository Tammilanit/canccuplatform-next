-- Previews on a screen (contracts/screen.md, Zones and assignments: Preview on a screen; #444).
-- Additive: a new table. One row per device at most; any container serves and ends them.
-- `zone` is Studio's unsaved zone (null: the device's own); `ends_at` is `until`, or the 12 hours
-- a preview without one runs at most, so an expired row is ignored even before the tick removes it.
-- `theme_preview_key` turns null once theming no longer knows the key (the preview drops the draft).
CREATE TABLE screen_previews (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  device_id text NOT NULL,
  zone_key text NOT NULL,
  zone jsonb,
  at timestamptz,
  theme_preview_key text,
  until timestamptz,
  ends_at timestamptz NOT NULL,
  started_by text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, device_id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES screen_assignments (tenant_id, device_id) ON DELETE CASCADE
);

ALTER TABLE screen_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_previews FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_previews USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON screen_previews TO canccu_screen_app;
