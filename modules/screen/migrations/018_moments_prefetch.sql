-- Moments' preload per event (contracts/screen.md, The video step; #114): the files of the
-- storyboards' video steps, with the zones each plays on, kept from `moments.prefetch.changed`
-- and composed into those zones' `ScreenState.prefetch`. Additive. `event_id` is the newest
-- event applied (UUID v7, which sorts by time), so an event that comes twice or late changes nothing.
CREATE TABLE screen_moments_prefetch (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  files jsonb NOT NULL,
  event_id text COLLATE "C" NOT NULL,
  PRIMARY KEY (tenant_id)
);

ALTER TABLE screen_moments_prefetch ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_moments_prefetch FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_moments_prefetch USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON screen_moments_prefetch TO canccu_screen_app;
