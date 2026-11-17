-- Storyboards (#114; contracts/moments.md, Storyboards). Additive: two nullable columns and new
-- tables. Per event under RLS, as 001.

-- A round is one moment whose override carries `steps` (D9, SD1).
ALTER TABLE moments ADD COLUMN steps jsonb;
-- One happening, one owner (WD1): `type:source id`; a second live moment of it is refused.
ALTER TABLE moments ADD COLUMN happening text;
CREATE INDEX moments_running_happening ON moments (tenant_id, happening)
  WHERE ended_at IS NULL AND happening IS NOT NULL;

-- The event's stories, copied from the presets on first use (SD8, O7), and the timing settings.
-- `event` is the event's name, hostname, time zone and times as last read, so the tick fills
-- placeholders and draws QR codes without asking the tenants module each second.
CREATE TABLE moments_stories (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  stories jsonb NOT NULL,
  settings jsonb NOT NULL,
  event jsonb NOT NULL,
  revision integer NOT NULL,
  PRIMARY KEY (tenant_id)
);

-- One run of a story from its trigger to its end: the tick runs its rounds, waits, ends and
-- finale from this row alone, so a restart starts the round due now (SE4).
CREATE TABLE moments_story_runs (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  story_key text NOT NULL,
  -- What `per_source` keys on: the item, the session, the order, the clock time.
  source text NOT NULL,
  trigger_kind text NOT NULL,
  -- The trigger time T; an item trigger's follows the item's delays.
  t timestamptz NOT NULL,
  item_id text,
  facts jsonb NOT NULL,
  zones text[] NOT NULL,
  test boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  -- The first round not yet started or skipped.
  next_round integer NOT NULL DEFAULT 0,
  rounds_played integer NOT NULL DEFAULT 0,
  -- The round now on screen (its segments: the steps, a video, the steps after it), or null.
  round jsonb,
  finale_due boolean NOT NULL DEFAULT false,
  deferred_until timestamptz,
  -- Per zone: sounds of the run and of the round now (the story cap, SO2).
  sounds jsonb NOT NULL DEFAULT '{}',
  -- How long a video of the run was paused or played: the 6 h cap does not count it.
  uncounted_ms bigint NOT NULL DEFAULT 0,
  why text NOT NULL,
  actor_user_id text,
  actor_name text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  end_reason text,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX moments_story_runs_live ON moments_story_runs (tenant_id, story_key, source)
  WHERE status = 'live';
CREATE INDEX moments_story_runs_started ON moments_story_runs (tenant_id, story_key, started_at);

-- What triggers remember between ticks: a milestone's last value and peak, each zone's scene.
CREATE TABLE moments_story_marks (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  key text NOT NULL,
  value jsonb NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

ALTER TABLE moments_stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_stories FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_stories USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_story_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_story_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_story_runs USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE moments_story_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE moments_story_marks FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON moments_story_marks USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON moments_stories, moments_story_runs, moments_story_marks
  TO canccu_moments_app;
