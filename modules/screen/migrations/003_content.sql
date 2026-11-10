-- Playlists, schedule windows, pushes, each zone's tick state and the screen's copy of the
-- run-of-show (contracts/screen.md, Content and scheduling; #216). Additive: new per-tenant tables.

CREATE TABLE screen_playlists (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('regular', 'slideshow', 'break')),
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 999),
  slideshow_image_seconds integer CHECK (slideshow_image_seconds >= 1),
  -- The contract's BreakSettings, set exactly when type is 'break'.
  break jsonb CHECK ((type = 'break') = (break IS NOT NULL)),
  revision integer NOT NULL DEFAULT 1,
  changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE screen_playlist_items (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  playlist_id text NOT NULL,
  id text NOT NULL,
  position integer NOT NULL,
  asset_id text NOT NULL,
  duration_seconds numeric CHECK (duration_seconds >= 1),
  slide_start integer CHECK (slide_start >= 1),
  slide_end integer CHECK (slide_end >= 1),
  slide_seconds integer CHECK (slide_seconds >= 1),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, playlist_id, position),
  FOREIGN KEY (tenant_id, playlist_id) REFERENCES screen_playlists (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX screen_playlist_items_asset ON screen_playlist_items (tenant_id, asset_id);

-- The zone's foreign key (no cascade) is the backstop of zone_in_use; a playlist's windows go
-- with it ("Delete a playlist with its items and windows").
CREATE TABLE screen_schedules (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  zone_key text NOT NULL,
  playlist_id text NOT NULL,
  priority integer NOT NULL CHECK (priority BETWEEN 0 AND 999),
  layout_id text,
  days integer[],
  start_minute integer CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute integer CHECK (end_minute BETWEEN 0 AND 1440),
  agenda_item_id text,
  revision integer NOT NULL DEFAULT 1,
  changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CHECK ((agenda_item_id IS NULL) = (days IS NOT NULL AND start_minute IS NOT NULL AND end_minute IS NOT NULL)),
  FOREIGN KEY (tenant_id, zone_key) REFERENCES screen_zones (tenant_id, key),
  FOREIGN KEY (tenant_id, playlist_id) REFERENCES screen_playlists (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX screen_schedules_zone ON screen_schedules (tenant_id, zone_key);
CREATE INDEX screen_schedules_playlist ON screen_schedules (tenant_id, playlist_id);

-- A push is active while ended_at is null and until is ahead. zones empty means every zone.
CREATE TABLE screen_pushes (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  zones text[] NOT NULL,
  playlist_id text,
  asset_id text,
  until timestamptz NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  end_reason text CHECK (end_reason IN ('cleared', 'expired')),
  PRIMARY KEY (tenant_id, id),
  CHECK (num_nonnulls(playlist_id, asset_id) = 1)
);
CREATE INDEX screen_pushes_open ON screen_pushes (tenant_id, until) WHERE ended_at IS NULL;

-- What the zone's tick alone writes: what plays, the bookmarks and the break state. It goes with
-- the zone, so a zone made again under the same key starts afresh.
CREATE TABLE screen_zone_playback (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  zone_key text NOT NULL,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, zone_key),
  FOREIGN KEY (tenant_id, zone_key) REFERENCES screen_zones (tenant_id, key) ON DELETE CASCADE
);

-- The run-of-show as the agenda's events tell it (src/content/agenda.ts). A removed item stays
-- as a row with removed = true, so an older event replayed later cannot bring it back.
CREATE TABLE screen_agenda_items (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  starts_at timestamptz,
  ends_at timestamptz,
  status text NOT NULL CHECK (status IN ('scheduled', 'cancelled')),
  removed boolean NOT NULL DEFAULT false,
  revision integer NOT NULL,
  agenda_version integer,
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE screen_playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_playlists FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_playlists USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));
ALTER TABLE screen_playlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_playlist_items FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_playlist_items USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));
ALTER TABLE screen_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_schedules USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));
ALTER TABLE screen_pushes ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_pushes FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_pushes USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));
ALTER TABLE screen_zone_playback ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_zone_playback FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_zone_playback USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));
ALTER TABLE screen_agenda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_agenda_items FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_agenda_items USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON screen_playlists, screen_playlist_items, screen_schedules,
  screen_pushes, screen_zone_playback, screen_agenda_items TO canccu_screen_app;
