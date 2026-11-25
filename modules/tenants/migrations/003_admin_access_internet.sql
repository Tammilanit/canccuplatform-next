-- Organiser pages open from anywhere with sign-in by default; venue-only is an organiser's choice
-- (contracts/tenants.md, Admin access; 0022 as amended 2026-11-23; #778).

ALTER TABLE tenants ALTER COLUMN admin_access SET DEFAULT 'internet';

-- An event that never chose keeps the old default only by accident, so it moves to the new one.
-- Every choice is in the event's audit log (a `tenants.tenant.changed` whose changes name
-- `admin_access`), so an event that chose `restricted` keeps it. The audit table is a tenant
-- table and RLS binds the migration role too, so each event is read in its own tenant setting;
-- the explicit tenant_id keeps the check right for a role RLS does not bind.
-- The move is audited like any change of the setting, which is also how a revert finds it.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT id FROM tenants WHERE admin_access = 'restricted' ORDER BY id LOOP
    PERFORM set_config('canccu.tenant', t.id, true);
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM audit
      WHERE tenant_id = t.id AND action = 'tenants.tenant.changed' AND changes ? 'admin_access'
    );
    UPDATE tenants SET admin_access = 'internet', revision = revision + 1 WHERE id = t.id;
    INSERT INTO audit (id, actor, action, target, changes, reason) VALUES (
      gen_random_uuid()::text,
      '{"kind": "system", "ref": null, "superadmin": false, "support": false}',
      'tenants.tenant.changed',
      jsonb_build_object('type', 'tenant', 'id', t.id),
      '{"admin_access": {"old": "restricted", "new": "internet"}}',
      'the platform default changed to internet (#778); the event never chose a value'
    );
  END LOOP;
  PERFORM set_config('canccu.tenant', '', true);
END
$$;
