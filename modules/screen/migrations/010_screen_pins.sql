-- The event's pins (contracts/screen.md, Pins and Timed pins and freeze; #265). Additive: one
-- per-tenant table and one global list of the events that have a pin.

-- One row per event, once its pin first changes. `restores` is the pin `until` puts back
-- ({bundle_version, theme_revision}); a pin without `until` has none. `changed_by_name` is the
-- name Studio shows beside `changed_by`, kept as it was when the pin changed.
CREATE TABLE screen_pins (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  bundle_version text,
  theme_revision integer CHECK (theme_revision >= 1),
  until timestamptz,
  restores jsonb,
  changed_by text,
  changed_by_name text,
  changed_at timestamptz,
  PRIMARY KEY (tenant_id),
  CHECK ((until IS NULL) = (restores IS NULL))
);

ALTER TABLE screen_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_pins FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_pins USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

-- The events whose pin holds anything, so the tick (a timed pin's end) and the bundle retention
-- find them without a tenant set: RLS hides screen_pins outside a tenant's context. A plain
-- tenant reference and nothing else; written in the pin's own transaction.
CREATE TABLE screen_pin_tenants (
  tenant_id text PRIMARY KEY
);

GRANT SELECT, INSERT, UPDATE ON screen_pins TO canccu_screen_app;
GRANT SELECT, INSERT, DELETE ON screen_pin_tenants TO canccu_screen_app;
