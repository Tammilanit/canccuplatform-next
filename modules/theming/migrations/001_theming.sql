-- The theming store (contracts/theming.md; docs/plans/issue-185.md, D3 and D4). Every table is per
-- event under RLS; requests run as canccu_theming_app.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'canccu_theming_app') THEN
    CREATE ROLE canccu_theming_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- Stored files, content-addressed: one row per file a tenant holds, whatever refers to it.
CREATE TABLE files (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ext text NOT NULL CHECK (ext IN ('css', 'woff2', 'png', 'jpg', 'webp', 'svg')),
  bytes bigint NOT NULL CHECK (bytes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sha256, ext)
);

-- The one editable copy of an event's theme.
CREATE TABLE drafts (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), '') PRIMARY KEY,
  draft_version integer NOT NULL DEFAULT 1,
  -- The unguessable part of draft embed addresses; replaced on every change (contracts/theming.md, Preview).
  draft_key text NOT NULL,
  created_from integer,
  manifest jsonb NOT NULL,
  problems jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Published revisions: immutable once written; the highest is the current one.
CREATE TABLE revisions (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  revision integer NOT NULL CHECK (revision >= 1),
  published_at timestamptz NOT NULL DEFAULT now(),
  manifest jsonb NOT NULL,
  -- Every token filled in, as GET /api/theming/current answers them.
  tokens jsonb NOT NULL,
  -- Served file names (<sha256>.<ext>) generated at publish, so reads never build them.
  tokens_css text NOT NULL,
  admin_tokens_css text NOT NULL,
  css text,
  logo text,
  embed_color integer NOT NULL CHECK (embed_color BETWEEN 0 AND 16777215),
  restored_from integer,
  cloned_from jsonb,
  changed text[] NOT NULL DEFAULT '{}',
  actor_user_id text,
  PRIMARY KEY (tenant_id, revision)
);

-- What refers to a file: 'draft' or 'r:<revision>'. A file with no row here is deleted.
CREATE TABLE file_refs (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  owner text NOT NULL CHECK (owner = 'draft' OR owner ~ '^r:[1-9][0-9]*$'),
  file text NOT NULL CHECK (file ~ '^[0-9a-f]{64}\.(css|woff2|png|jpg|webp|svg)$'),
  PRIMARY KEY (tenant_id, owner, file)
);
CREATE INDEX file_refs_file ON file_refs (tenant_id, file);

-- The theme revision the event's screens are pinned to, learnt from screen.pin.changed; kept
-- whatever its age (contracts/theming.md, Kept).
CREATE TABLE pins (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), '') PRIMARY KEY,
  theme_revision integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON files USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON drafts USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON revisions USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE file_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_refs FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON file_refs USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE pins FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON pins USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT USAGE ON SCHEMA public TO canccu_theming_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON files, drafts, revisions, file_refs, pins TO canccu_theming_app;
