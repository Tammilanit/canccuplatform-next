-- Embed files (contracts/theming.md, Embeds and The sandbox; #186). An embed's HTML, JS and JSON are
-- stored like every theme file, content-addressed, but only theming_embed_files refers to them, and
-- only the sandbox path serves what it lists: never /theming/a/ or /theming/draft/, which go by
-- theming_file_refs, whose own check keeps those names out.

-- Widened, not narrowed: every row the old check took, this one takes.
ALTER TABLE theming_files DROP CONSTRAINT theming_files_ext_check;
ALTER TABLE theming_files ADD CONSTRAINT theming_files_ext_check
  CHECK (ext IN ('css', 'woff2', 'png', 'jpg', 'webp', 'svg', 'html', 'js', 'json'));

-- One row per file of an embed, per owner ('draft' or 'r:<revision>'), by its path inside the
-- embed's folder (`embeds/<embed>/<path>` in the package).
CREATE TABLE theming_embed_files (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  owner text NOT NULL CHECK (owner = 'draft' OR owner ~ '^r:[1-9][0-9]*$'),
  embed text NOT NULL CHECK (embed ~ '^[a-z][a-z0-9_-]{0,31}$'),
  path text NOT NULL CHECK (path ~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$' AND path !~ '(^|/)\.\.?(/|$)'),
  file text NOT NULL CHECK (file ~ '^[0-9a-f]{64}\.(html|js|css|json|png|jpg|webp|svg|woff2)$'),
  -- The embed's HTML entry: served only to a frame; every other file only to the sandbox itself.
  entry boolean NOT NULL,
  PRIMARY KEY (tenant_id, owner, embed, path)
);
-- One entry per embed and owner.
CREATE UNIQUE INDEX theming_embed_files_entry ON theming_embed_files (tenant_id, owner, embed) WHERE entry;
CREATE INDEX theming_embed_files_file ON theming_embed_files (tenant_id, file);

ALTER TABLE theming_embed_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE theming_embed_files FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON theming_embed_files USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON theming_embed_files TO canccu_theming_app;
