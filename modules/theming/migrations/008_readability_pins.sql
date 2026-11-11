-- The small-text warning, pins and retention (contracts/theming.md, Advanced mode and Draft,
-- preview, publish; #246). Columns only added, so every row keeps its data.

-- What a stored CSS file sets as font sizes, from its upload (src/readability.ts), so every draft
-- change re-checks the theme's text with the root size any of its files sets, without reading
-- the files again. Files stored before this column hold none, until they are uploaded again.
ALTER TABLE theming_package_files ADD COLUMN font_sizes jsonb NOT NULL DEFAULT '[]';

-- The revision a timed pin puts back at its `until` (screen.pin.changed `restores.theme_revision`),
-- kept like the pinned one. `event_time` and `event_id` name the pin event the row holds, so an
-- older one, read again from the stream at start, never replaces it.
ALTER TABLE theming_pins
  ADD COLUMN restores_revision integer,
  ADD COLUMN event_time timestamptz,
  ADD COLUMN event_id text;
