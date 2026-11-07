# tenants

The tenants module serves [contracts/tenants.md](../../contracts/tenants.md) on the kit's tenancy ([0013](../../docs/decisions/0013-multi-tenant-core.md)). It holds the registry of events (tenants), their hostnames, venues and venue info, access settings, feature flags, lifecycle and the audit log. Plan and scope: [docs/plans/issue-50.md](../../docs/plans/issue-50.md). Users, members, event admins' API, support windows, series and clone, privacy, retention and deletion follow in #150, after the central sign-in (#52).

## How it works
- **Tenancy:** each request's tenant comes from its `Host`, looked up exactly among `active` hostnames, through the kit's `TenancyMiddleware`. An unknown host gets 404 with no detail. `/health` is exempt, and so is `/internal/tenants/…`, which is answered without tenant resolution and is never routed by Caddy.
- **Postgres:** `migrations/*.sql` run at every start, under an advisory lock. The global tables are on `scripts/tenancy-global-tables.txt`; every other table is per tenant, under RLS. Requests run as `canccu_tenants_app` (`SET LOCAL ROLE` inside each transaction), which RLS binds and which may only insert into and read the audit tables.
- **Caller:** admin's session through the kit's `RightsChecker`; its user id is the tenants user id. The event-admin role (this module's `event_admins`) holds every right. A right granted in admin's session counts too, except the role-only `tenants.admins.write`, `tenants.lifecycle.write` and `tenants.access.write`. Superadmin paths answer only on `CANCCU_SUPERADMIN_HOSTNAME` and need the user's `superadmin` and `mfa_enabled`.
- **Events:** published after the commit; audit entries are written in the same transaction as the change.
- **Timers:** every 30 s, in every container: the venue IP check's switch back and the end of a hostname's 30-day hold.

## Environment
`CANCCU_DATABASE_URL`, plus the kit's `CANCCU_MODULE`, `CANCCU_VERSION`, `CANCCU_VALKEY_URL`, `CANCCU_ADMIN_URL`. Optional: `CANCCU_SIGNIN_HOSTNAME`, `CANCCU_SUPERADMIN_HOSTNAME` (platform hostnames: never resolved to a tenant, never registrable), `CANCCU_PLATFORM_DOMAIN` (decides `platform` vs `custom` hostnames; the demo seed adds `demo.<domain>`), `CANCCU_TAILSCALE_CIDRS`, `CANCCU_TRUSTED_PROXIES` (whose `X-Forwarded-For` counts), `CANCCU_SEED_DEMO=1`, `CANCCU_IP_MODE=demo` (only with version `dev`), `CANCCU_FILES_ROOT` (default `/files`), `CANCCU_FLAGS_FILE` (default `/repo/contracts/flags.yaml`; missing = no flags declared).

## Shell commands
```sh
docker compose -f deploy/compose.yml exec tenants python -m canccu_tenants seed-demo
docker compose -f deploy/compose.yml exec tenants python -m canccu_tenants superadmin add --discord-id <id> --name <name>
```
The demo seed creates the venue `demo-venue` and the live tenant `demo`; it changes nothing when `demo` exists. A new superadmin has `mfa_enabled` false until sign-in reports Discord two-factor (#52), so the superadmin paths stay closed until then.

## Check
```sh
pip install -e ".[dev]" && ruff check . && ruff format --check . && mypy . && pytest
```
The tests need a real Postgres, because RLS and the grants cannot be faked; without `CANCCU_DATABASE_URL` they are skipped. They include the cross-tenant leak tests (`tests/test_leak.py`). CI runs them in the `integration (kit)` job:
```sh
docker compose -f ../../deploy/compose.yml -f ../../deploy/compose.test.yml up -d --wait postgres
CANCCU_DATABASE_URL=postgres://canccu:canccu-local-only@127.0.0.1:5432/canccu pytest
```
