-- The ticker, its weekly windows and the carousel photos (contracts/screen.md, Ticker and
-- Photos; #218). Additive: three new per-tenant tables.

-- One row per event. The manual line (`text` to `source`) is null once cleared; `announced` is
-- the ticker last sent as `screen.ticker.changed`, so a window starting or a line running out is
-- announced once, by whichever writer sees the change first (src/ticker/store.ts).
CREATE TABLE screen_ticker (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  text text CHECK (char_length(text) BETWEEN 1 AND 280),
  until timestamptz,
  source text CHECK (source IN ('admin', 'bot')),
  announced jsonb,
  PRIMARY KEY (tenant_id),
  CHECK ((text IS NULL) = (source IS NULL))
);

CREATE TABLE screen_ticker_windows (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 280),
  days smallint[] NOT NULL,
  start_minute smallint NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute smallint NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- A photo refers to its file as an asset version does, so identical bytes share one file and the
-- file goes with the last row of either kind (src/assets/files.ts).
CREATE TABLE screen_photos (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  file text NOT NULL,
  caption text,
  author_name text,
  author_user_id text,
  posted_at timestamptz NOT NULL,
  source_ref text,
  featured boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, file) REFERENCES screen_files (tenant_id, name)
);
CREATE INDEX screen_photos_newest ON screen_photos (tenant_id, created_at DESC, id DESC);
CREATE INDEX screen_photos_file ON screen_photos (tenant_id, file);
CREATE INDEX screen_photos_author ON screen_photos (tenant_id, author_user_id);
-- A source's message is added once (409 `photo_exists`); the index decides between two racing adds.
CREATE UNIQUE INDEX screen_photos_source_ref ON screen_photos (tenant_id, source_ref);

ALTER TABLE screen_ticker ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_ticker FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_ticker USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));
ALTER TABLE screen_ticker_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_ticker_windows FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_ticker_windows USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));
ALTER TABLE screen_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_photos FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON screen_photos USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON screen_ticker, screen_ticker_windows, screen_photos TO canccu_screen_app;
