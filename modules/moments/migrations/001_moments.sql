-- The moments module's tables (contracts/moments.md): every running, hidden and waiting moment is
-- a row, so a restart loses nothing (E2). Requests run as canccu_moments_app (SET LOCAL ROLE),
-- which RLS binds on every tenant table. Runs once: kit-ts runMigrations records it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'canccu_moments_app') THEN
    CREATE ROLE canccu_moments_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

CREATE TABLE moments (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  class text NOT NULL,
  kind text NOT NULL,
  regions text[] NOT NULL,
  template text NOT NULL,
  content jsonb NOT NULL,
  -- Empty: every zone of the event.
  zones text[] NOT NULL,
  -- Zones it gave up or was ended on; its overrides never show there again.
  left_zones text[] NOT NULL DEFAULT '{}',
  origin text NOT NULL,
  rule_id text,
  source jsonb NOT NULL,
  -- Why it started, as the history says it: the rule and its event, or the person and the action.
  why text NOT NULL,
  actor_user_id text,
  actor_name text,
  -- A request naming a running moment's key renews it (E4).
  dedupe_key text,
  starts_at timestamptz NOT NULL,
  -- NULL: no end of its own (an emergency).
  expires_at timestamptz,
  ttl_seconds integer,
  patience_seconds integer NOT NULL,
  qr jsonb,
  binding jsonb,
  ended_at timestamptz,
  end_reason text,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX moments_running_key ON moments (tenant_id, dedupe_key)
  WHERE ended_at IS NULL AND dedupe_key IS NOT NULL;
CREATE INDEX moments_running ON moments (tenant_id, expires_at) WHERE ended_at IS NULL;

-- The overrides each moment was shown by, as last sent, so a change sends only what changed.
CREATE TABLE moment_overrides (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  override_id text NOT NULL,
  moment_id text NOT NULL,
  sent jsonb NOT NULL,
  ended boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, override_id),
  FOREIGN KEY (tenant_id, moment_id) REFERENCES moments (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX moment_overrides_moment ON moment_overrides (tenant_id, moment_id);

-- Where Screen placed each override on each zone (screen.claims.changed).
CREATE TABLE moment_placements (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  override_id text NOT NULL,
  zone_key text NOT NULL,
  moment_id text NOT NULL,
  state text NOT NULL,
  role text,
  since timestamptz NOT NULL,
  -- Patience counts only until the first place on the zone (contracts/moments.md).
  placed_once boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, override_id, zone_key),
  FOREIGN KEY (tenant_id, moment_id) REFERENCES moments (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX moment_placements_zone ON moment_placements (tenant_id, zone_key);

-- The event's zones as Screen named them, for moments on every zone that must narrow (D3).
CREATE TABLE moments_zones (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  zone_key text NOT NULL,
  PRIMARY KEY (tenant_id, zone_key)
);

CREATE TABLE moments_priorities (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  event_order text[] NOT NULL,
  -- {"<zone key>": [classes]}: the zones with an order of their own.
  zone_orders jsonb NOT NULL,
  revision integer NOT NULL,
  PRIMARY KEY (tenant_id)
);

-- A built-in rule's settings, once an organiser changed them; absent rows are the defaults.
CREATE TABLE moments_rules (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  rule_id text NOT NULL,
  settings jsonb NOT NULL,
  revision integer NOT NULL,
  PRIMARY KEY (tenant_id, rule_id)
);

-- The latest leaderboard and sessions, for bound moments and the crew spotlight (D18).
CREATE TABLE moments_sources (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  kind text NOT NULL,
  ref text NOT NULL,
  data jsonb NOT NULL,
  -- The source's own revision: an older event never overwrites a newer one.
  revision bigint NOT NULL,
  PRIMARY KEY (tenant_id, kind, ref)
);

CREATE TABLE moments_history (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  at timestamptz NOT NULL,
  -- NULL: the whole moment, on every zone it names.
  zone_key text,
  action text NOT NULL,
  moment_id text,
  class text NOT NULL,
  origin text NOT NULL,
  title text NOT NULL,
  region text,
  why text NOT NULL,
  displaced text,
  outcome text,
  actor_user_id text,
  actor_name text,
  PRIMARY KEY (tenant_id, seq)
);
CREATE INDEX moments_history_zone ON moments_history (tenant_id, zone_key, seq);

-- A crew action's answer by its key (E18), kept 24 hours.
CREATE TABLE moments_idempotency (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  user_id text NOT NULL,
  key text NOT NULL,
  status integer,
  body jsonb,
  at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, user_id, key)
);

CREATE TABLE moments_outbox (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  event text NOT NULL,
  PRIMARY KEY (tenant_id, seq)
);

ALTER TABLE moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moment_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE moment_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moment_overrides USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moment_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE moment_placements FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moment_placements USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_zones FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_zones USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_priorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_priorities FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_priorities USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_rules USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_sources USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_history FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_history USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_idempotency USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_outbox USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON moments, moment_overrides, moment_placements, moments_zones, moments_priorities, moments_rules, moments_sources, moments_history, moments_idempotency, moments_outbox TO canccu_moments_app;

-- Global: the events with pending outbox rows, so the sender finds them without a tenant set.
CREATE TABLE moments_outbox_tenants (
  tenant_id text PRIMARY KEY
);
-- Global: every event Moments has served, so the tick visits them without a tenant set, the
-- venue-wide emergency finds them, and the history is deleted 30 days after archiving (D21).
CREATE TABLE moments_tenants (
  tenant_id text PRIMARY KEY,
  archived_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON moments_outbox_tenants, moments_tenants TO canccu_moments_app;
