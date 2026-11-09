# agenda

The agenda module serves [contracts/agenda.md](../../contracts/agenda.md): the run-of-show of each event (tenant), its own list of kinds, and now and next. Plan and split: [docs/plans/issue-187.md](../../docs/plans/issue-187.md). This is package 1 (#187): kinds, adding, editing and moving items, reading, and now and next. Delay, cancel, remove, the reminder scheduler and the tournament-session mirror follow in #210, the run-of-show pages in #211 and #212, clone after the tenants series API (#150).

## How it works
- **Tenancy:** each request's event comes from its `Host`, through the kit's `TenancyMiddleware` and `TenantResolver` (`CANCCU_TENANTS_URL`). Every table is per tenant under RLS; requests run as `canccu_agenda_app` (`SET LOCAL ROLE` inside each transaction).
- **First use:** an event's counters (`agenda_version`, `kinds_version`) and the starter kinds are made in its own context on its first agenda request. No job walks every tenant.
- **Writes:** one transaction per write takes the event's counter row `FOR UPDATE`, so `agenda_version` and `kinds_version` never skip or repeat. Events are published after the commit.
- **Who reads what:** guests read `public` items when the event's info-page mode lets them; any valid session on the event's hostname also reads `attendees` items until the tenants membership API lands (#150; `access.is_member`); `agenda.crew.read` adds `crew` items.
- **Archived events:** writes get 409 `event_archived`. The status comes from the resolver's tenant context, which the module drops on every tenants event.
- **Settings** (`reminder_leads_minutes`, `notify_channels`, declared in `modules/admin/declarations/agenda.yaml`) come through the kit's `SettingsClient`; `notify_channels` in effect is the item's choice, else its kind's, else the event's.

## Environment
`CANCCU_DATABASE_URL`, `CANCCU_TENANTS_URL`, plus the kit's `CANCCU_MODULE`, `CANCCU_VERSION`, `CANCCU_VALKEY_URL`, `CANCCU_ADMIN_URL`, `CANCCU_SERVICE_KEY`. Optional: `CANCCU_MIGRATE_DATABASE_URL` (the migration role; without it the login role migrates, as in the tests), `CANCCU_SIGNIN_HOSTNAME`, `CANCCU_SUPERADMIN_HOSTNAME`, `CANCCU_IP_MODE=demo` (only with version `dev`), `CANCCU_TRUSTED_PROXIES`.

Through Caddy: `/api/agenda/health` and the contract's `/api/agenda/…` paths.

## Check
```sh
pip install -e ".[dev]" && ruff check . && ruff format --check . && mypy . && pytest
```
The tests need a real Postgres, because RLS cannot be faked; without `CANCCU_DATABASE_URL` they are skipped. They include the cross-tenant leak tests (`tests/test_leak.py`). CI runs them in the `integration (kit)` job:
```sh
docker compose -f ../../deploy/compose.yml -f ../../deploy/compose.test.yml up -d --wait postgres
CANCCU_DATABASE_URL=postgres://canccu:canccu-local-only@127.0.0.1:5432/canccu pytest
```
