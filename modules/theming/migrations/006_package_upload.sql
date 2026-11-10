-- The whole-package upload (`PUT /api/theming/draft/package`, #244). Each check is widened, never
-- narrowed: every row the old checks took the new ones take too, so no data changes.
--
-- Font licences (`fonts/*.txt`, `*.md`) are stored files like any other: counted against the
-- quota, copied by publish and written back by the export. They are never served: the served paths
-- answer only the types of files.ts `FILE_NAME`.
ALTER TABLE theming_files DROP CONSTRAINT theming_files_ext_check;
ALTER TABLE theming_files ADD CONSTRAINT theming_files_ext_check
  CHECK (ext IN ('css', 'woff2', 'png', 'jpg', 'webp', 'svg', 'txt', 'md'));

ALTER TABLE theming_file_refs DROP CONSTRAINT theming_file_refs_file_check;
ALTER TABLE theming_file_refs ADD CONSTRAINT theming_file_refs_file_check
  CHECK (file ~ '^[0-9a-f]{64}\.(css|woff2|png|jpg|webp|svg|txt|md)$');

-- An embed's file that failed its checks holds its problem at its package path, as any other
-- failed upload does. Its stored files stay only in theming_embed_files (002), so an `embeds/`
-- path here never holds a file.
ALTER TABLE theming_package_files DROP CONSTRAINT theming_package_files_path_check;
ALTER TABLE theming_package_files ADD CONSTRAINT theming_package_files_path_check CHECK (
  length(path) <= 136
  AND path ~ '^(css|fonts|images|templates|embeds)/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
  AND path !~ '(^|/)\.\.?(/|$)'
);
ALTER TABLE theming_package_files ADD CONSTRAINT theming_package_files_embeds_problems
  CHECK (path !~ '^embeds/' OR file IS NULL);
