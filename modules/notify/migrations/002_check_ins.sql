-- Check-in by the rotating QR (contracts/notify.md; docs/plans/issue-188.md, area L and D5).
-- Additive: two new per-tenant tables under RLS.

-- One random key per event, sealed with the platform secrets key (0013 item 29); no code is
-- stored, the server recomputes it. Made on the event's first code request.
CREATE TABLE IF NOT EXISTS notify_check_in_keys (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  sealed text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id)
);

-- Presence data: deleted 30 days after the archive (contracts/notify.md, Tenancy). One per user
-- and purpose: the same check-in again answers the first one.
CREATE TABLE IF NOT EXISTS notify_check_ins (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  user_id text NOT NULL,
  purpose text NOT NULL,
  checked_in_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, user_id, purpose)
);

ALTER TABLE notify_check_in_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_check_in_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON notify_check_in_keys USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE notify_check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_check_ins FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON notify_check_ins USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT ON notify_check_in_keys TO canccu_notify_app;
GRANT SELECT, INSERT, DELETE ON notify_check_ins TO canccu_notify_app;
