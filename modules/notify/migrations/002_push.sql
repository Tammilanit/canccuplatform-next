-- Web Push (#225, plan issue-188 F, G, H): subscriptions, one delivery row per recipient and
-- channel, and the events that have deliveries waiting. Additive only.

-- The event's info-page mode as the tenants module last told a request, next to its time zone:
-- pushes to guests follow it (contracts/notify.md, Info-page mode) and the sender has no request.
ALTER TABLE notify_event_state ADD COLUMN IF NOT EXISTS info_page_mode text;

-- The endpoint is in clear, as the replace key; the browser's p256dh and auth keys, which let
-- anyone push to the phone, are sealed with the kit's SecretBox (plan D4). The subscription token
-- is kept only as its SHA-256. user_id NULL is a guest.
CREATE TABLE IF NOT EXISTS notify_subscriptions (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  user_id text,
  token_hash text NOT NULL,
  endpoint text NOT NULL,
  keys_sealed text NOT NULL,
  preferences jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, endpoint)
);
CREATE INDEX IF NOT EXISTS notify_subscriptions_user ON notify_subscriptions (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS notify_subscriptions_token
  ON notify_subscriptions (tenant_id, token_hash);

-- Rows, not memory: containers keep no state and may run more than once (plan D7). `recipient` is
-- `user:<id>`, or `sub:<id>` for a guest, the unit of the hourly cap. subscription_id is a plain
-- reference: a sent row still counts toward the cap after its subscription is gone.
CREATE TABLE IF NOT EXISTS notify_deliveries (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id bigserial NOT NULL,
  notification_id text NOT NULL,
  recipient text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('push', 'discord_dm')),
  subscription_id text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'held', 'sent', 'capped', 'failed', 'skipped')),
  created_at timestamptz NOT NULL,
  done_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, notification_id)
    REFERENCES notify_notifications (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS notify_deliveries_pending
  ON notify_deliveries (tenant_id, id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS notify_deliveries_cap
  ON notify_deliveries (tenant_id, recipient, done_at) WHERE status = 'sent';

-- The events with deliveries waiting, so the sender finds them without a tenant set: RLS hides
-- notify_deliveries outside a tenant's context. A plain tenant reference and nothing else.
CREATE TABLE IF NOT EXISTS notify_delivery_tenants (
  tenant_id text PRIMARY KEY
);

ALTER TABLE notify_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON notify_subscriptions USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE notify_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON notify_deliveries USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON notify_subscriptions, notify_deliveries
  TO canccu_notify_app;
GRANT USAGE ON SEQUENCE notify_deliveries_id_seq TO canccu_notify_app;
GRANT SELECT, INSERT, DELETE ON notify_delivery_tenants TO canccu_notify_app;
