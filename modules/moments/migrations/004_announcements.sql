-- Announcements (#115; contracts/moments.md, Announcements). Additive. Per event under RLS, as 001.

-- One announcement from its composing to its end. Its card and its ticker line are moments
-- (`moments` rows); this row keeps what they were made from, so an edit or a scheduled send fills
-- the texts again, and the tick can send, follow the item and end it from the rows alone.
CREATE TABLE moments_announcements (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  status text NOT NULL,
  level text NOT NULL,
  full_screen boolean NOT NULL,
  title_text text NOT NULL,
  body_text text NOT NULL,
  variables jsonb NOT NULL,
  item_id text,
  title text,
  body text,
  channels jsonb NOT NULL,
  zones text[] NOT NULL,
  duration_seconds integer NOT NULL,
  "when" jsonb NOT NULL,
  fire_at timestamptz,
  -- Captured when it was composed, so the tick fills `{event.name}` and times without asking.
  event_name text NOT NULL,
  time_zone text NOT NULL,
  template_key text,
  card_moment_id text,
  line_moment_id text,
  sent_at timestamptz,
  expires_at timestamptz,
  updated_until timestamptz,
  ended_at timestamptz,
  end_reason text,
  why text,
  actor_user_id text,
  actor_name text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX moments_announcements_open ON moments_announcements (tenant_id, status)
  WHERE status IN ('scheduled', 'live');

-- The event's own templates; the built-ins are platform data in the code.
CREATE TABLE moments_announcement_templates (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  key text NOT NULL,
  name text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  level text NOT NULL,
  revision integer NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

ALTER TABLE moments_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_announcements FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_announcements USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_announcement_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_announcement_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_announcement_templates USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON moments_announcements, moments_announcement_templates TO canccu_moments_app;
