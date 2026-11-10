-- The package's files by path, per owner ('draft' or 'r:<revision>'): what `PUT …/draft/file?path=`
-- stores, publish and restore copy, and the draft lists as `files` (contracts/theming.md, Draft,
-- preview, publish; #242). The stored file itself stays in theming_files, and theming_file_refs
-- keeps naming every file an owner refers to, which the served paths go by. Embed files keep their
-- own table (002).
--
-- An upload that fails its checks stores nothing: its path holds the problem instead of a file,
-- so the draft's problems keep naming it until it is replaced or removed.
CREATE TABLE theming_package_files (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  owner text NOT NULL CHECK (owner = 'draft' OR owner ~ '^r:[1-9][0-9]*$'),
  path text NOT NULL CHECK (
    length(path) <= 136
    AND path ~ '^(css|fonts|images|templates)/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
    AND path !~ '(^|/)\.\.?(/|$)'
  ),
  file text CHECK (file ~ '^[0-9a-f]{64}\.[a-z0-9]{1,8}$'),
  bytes bigint CHECK (bytes >= 0),
  problem jsonb,
  CHECK ((file IS NULL) = (bytes IS NULL) AND (file IS NULL) = (problem IS NOT NULL)),
  PRIMARY KEY (tenant_id, owner, path)
);
CREATE INDEX theming_package_files_file ON theming_package_files (tenant_id, file);

ALTER TABLE theming_package_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE theming_package_files FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON theming_package_files USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON theming_package_files TO canccu_theming_app;
