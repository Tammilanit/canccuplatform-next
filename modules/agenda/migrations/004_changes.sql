-- The run-of-show pages' safety (#212, plan issue-187 D12, D13): the change log and the undo
-- records. Page data, not part of the agenda API. Additive only.

-- One row per revision of an item ('added' at 1, 'changed' at each later one) and one when it is
-- removed. `old` and `new` hold the changed fields as the API writes them. The pages show who
-- changed what, and re-apply a stale edit only when every revision since is here.
CREATE TABLE IF NOT EXISTS agenda_changes (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  item_id text NOT NULL,
  revision integer NOT NULL,
  action text NOT NULL CHECK (action IN ('added', 'changed', 'removed')),
  actor_user_id text,
  actor_name text NOT NULL,
  fields text[] NOT NULL DEFAULT '{}',
  old jsonb NOT NULL DEFAULT '{}',
  new jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, item_id, revision, action)
);

-- The inverse of one page action, for its author, until `expires_at` (2 minutes). `steps` names
-- each item it touches at the revision the action left it, so an undo never overwrites a later
-- change.
CREATE TABLE IF NOT EXISTS agenda_undo (
  tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
  id text NOT NULL,
  actor_user_id text NOT NULL,
  steps jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE agenda_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON agenda_changes USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

ALTER TABLE agenda_undo ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_undo FORCE ROW LEVEL SECURITY;
CREATE POLICY canccu_tenant ON agenda_undo USING (tenant_id = NULLIF(current_setting('canccu.tenant', true), '')) WITH CHECK (tenant_id = NULLIF(current_setting('canccu.tenant', true), ''));

GRANT SELECT, INSERT ON agenda_changes TO canccu_agenda_app;
GRANT SELECT, INSERT, DELETE ON agenda_undo TO canccu_agenda_app;
