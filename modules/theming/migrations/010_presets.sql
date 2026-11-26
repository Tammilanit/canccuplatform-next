-- My presets and video backgrounds (contracts/theming.md, Presets and The theme package; plan
-- issue-784 D18, D19). One new table; every check below is widened, never narrowed: each row the
-- old checks took the new ones take too, so no data changes.
--
-- A saved preset keeps the draft's manifest as it was saved. Its files are kept the way a
-- revision's are, by owner `p:<id>` in theming_file_refs, theming_package_files and
-- theming_embed_files, so the quota counts them and they go only when nothing refers to them.
CREATE TABLE theming_presets (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id integer GENERATED ALWAYS AS IDENTITY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  manifest jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE theming_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE theming_presets FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON theming_presets USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, DELETE ON theming_presets TO canccu_theming_app;

ALTER TABLE theming_file_refs DROP CONSTRAINT theming_file_refs_owner_check;
ALTER TABLE theming_file_refs ADD CONSTRAINT theming_file_refs_owner_check
  CHECK (owner = 'draft' OR owner ~ '^[rp]:[1-9][0-9]*$');
ALTER TABLE theming_package_files DROP CONSTRAINT theming_package_files_owner_check;
ALTER TABLE theming_package_files ADD CONSTRAINT theming_package_files_owner_check
  CHECK (owner = 'draft' OR owner ~ '^[rp]:[1-9][0-9]*$');
ALTER TABLE theming_embed_files DROP CONSTRAINT theming_embed_files_owner_check;
ALTER TABLE theming_embed_files ADD CONSTRAINT theming_embed_files_owner_check
  CHECK (owner = 'draft' OR owner ~ '^[rp]:[1-9][0-9]*$');

-- Videos: MP4 and WebM, recognised by content (uploads.ts), in the package's `videos/` folder.
ALTER TABLE theming_files DROP CONSTRAINT theming_files_ext_check;
ALTER TABLE theming_files ADD CONSTRAINT theming_files_ext_check
  CHECK (ext IN ('css', 'woff2', 'png', 'jpg', 'webp', 'svg', 'txt', 'md', 'mustache', 'mp4', 'webm'));

ALTER TABLE theming_file_refs DROP CONSTRAINT theming_file_refs_file_check;
ALTER TABLE theming_file_refs ADD CONSTRAINT theming_file_refs_file_check
  CHECK (file ~ '^[0-9a-f]{64}\.(css|woff2|png|jpg|webp|svg|txt|md|mustache|mp4|webm)$');

ALTER TABLE theming_package_files DROP CONSTRAINT theming_package_files_path_check;
ALTER TABLE theming_package_files ADD CONSTRAINT theming_package_files_path_check CHECK (
  length(path) <= 136
  AND path ~ '^(css|fonts|images|templates|embeds|videos)/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
  AND path !~ '(^|/)\.\.?(/|$)'
);
