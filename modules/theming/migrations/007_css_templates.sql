-- A theme's CSS and templates (contracts/theming.md, Advanced mode and Widget templates; #245).
-- Each check is widened, never narrowed: every row the old checks took the new ones take too.
--
-- A template is stored as its text (`mustache`), like a font's licence never served: surfaces get
-- only the parsed tree, which publish writes into the revision.
ALTER TABLE theming_files DROP CONSTRAINT theming_files_ext_check;
ALTER TABLE theming_files ADD CONSTRAINT theming_files_ext_check
  CHECK (ext IN ('css', 'woff2', 'png', 'jpg', 'webp', 'svg', 'txt', 'md', 'mustache'));

ALTER TABLE theming_file_refs DROP CONSTRAINT theming_file_refs_file_check;
ALTER TABLE theming_file_refs ADD CONSTRAINT theming_file_refs_file_check
  CHECK (file ~ '^[0-9a-f]{64}\.(css|woff2|png|jpg|webp|svg|txt|md|mustache)$');

-- What a stored CSS file or template found at upload, so every draft change re-checks it without
-- reading it again: `refs`, the package paths it names (url(), img src), which must be in the
-- package; `warnings`, its warnings (`class_unstable`).
ALTER TABLE theming_package_files
  ADD COLUMN refs text[] NOT NULL DEFAULT '{}',
  ADD COLUMN warnings jsonb NOT NULL DEFAULT '[]';

-- The revision's templates as `GET /api/theming/current` lists them (ParsedTemplate: name, widget,
-- tree with package images at their served addresses), written at publish like the compiled CSS.
ALTER TABLE theming_revisions ADD COLUMN templates jsonb NOT NULL DEFAULT '[]';
