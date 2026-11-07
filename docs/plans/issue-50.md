# Plan: issue #50 — the tenants module

Package `tenants-module`, branch `50-feat-tenants-tenants-module`. Roadmap step 2b item 3 ([roadmap](../roadmap.md#2b-tenancy-foundation)), [0013](../decisions/0013-multi-tenant-core.md). Sources of truth: `contracts/tenants.md` and `contracts/tenants.openapi.yaml` as merged in #134, and the kit's tenancy as merged in #138. This plan changes no contract.

## Why a plan first
1. **Size.** The contract has 40 paths and 61 operations (5 of them internal): the registry, hostnames with DNS verification and holds, venues with profiles and floor plans, venue info, users, superadmins, event admins, members, support windows, access settings, feature flags, series and clone, privacy, retention, user and tenant deletion, and the audit log, with 19 bus event types. A full build with tests is about 4,500–5,000 changed lines (estimate below), three times the package limit of about 1,500 ([AGENTS.md](../../AGENTS.md#how-work-flows)). Workers may not split an issue, so the lead or the maintainer has to decide the scope.
2. **Identity.** About half of the operations need the calling user, as a tenants user (`u_…`, Discord id, `mfa_enabled`, superadmin flag), on a session bound to one tenant. Both come from the central sign-in (#52), and #52 is blocked by #50. Today the only session is admin's single-event session (`GET /api/admin/session`). Its user ids come from `admin_users` and its rights from `admin_roles`, and neither knows the tenants roles. Every choice about how #50 learns the caller before #52 also shapes #52, so it is a decision, not a detail.

## Size by area (source plus tests, estimated)
| Area | Operations | Lines |
|---|---|---|
| A. Module skeleton: Starlette app, asyncpg pool, migrations with RLS, Dockerfile, compose service, IP-mode Caddy route `/api/tenants/*`, CI job | — | 350 |
| B. Registry, lifecycle, hostnames (platform and custom, TXT verify, 30-day hold, primary), `resolve`, `ask` | 16 | 1,000 |
| C. Current tenant (`GET`/`PATCH`), status, feature flags, venue IP check with its automatic switch back | 7 | 650 |
| D. Venues, profile, floor plans (files), venue info and copy-in, internal venue read | 10 | 750 |
| E. Users, superadmins, event admins, members, `me`, privacy, support windows, internal user read | 17 | 1,000 |
| F. Series and clone | 6 | 300 |
| G. Audit log: append-only role, internal append, both reads, pseudonymisation | 3 | 400 |
| H. Retention timer, user deletion, tenant deletion | 2 | 300 |
| I. Demo tenant and venue seed, cross-tenant leak tests in CI | — | 250 |
| **Total** | **61** | **≈ 5,000** |

## Design (holds for every scope option)
| # | Decision | Reason |
|---|---|---|
| D1 | Python 3.12, Starlette, asyncpg, uvicorn, on `canccu-kit[starlette]`, with the same pins as admin | The kit's tenancy is used the same way in both kits; admin already has the asyncpg, session and test patterns to copy, so the stack has one Python toolchain |
| D2 | Package `canccu_tenants` in `modules/tenants/`, port 8080, env `CANCCU_DATABASE_URL`, `CANCCU_SUPERADMIN_HOSTNAME`, `CANCCU_SIGNIN_HOSTNAME`, `CANCCU_PLATFORM_DOMAIN`, `CANCCU_TAILSCALE_CIDRS` | [ADR 0017](../decisions/0017-naming.md) names; `CANCCU_PLATFORM_DOMAIN` decides `kind: platform` vs `custom` |
| D3 | The global tables are exactly those already on `scripts/tenancy-global-tables.txt`. The per-tenant tables (`event_admins`, `members`, `flags`, `venue_info`, `audit`, `support_windows`) use `TENANT_COLUMN_SQL` and `rls_sql()`, and `scripts/check-tenancy` lints them | 0013 items 5–6; no change to the allow-list |
| D4 | Two database roles. The app role has RLS and may only `INSERT` and `SELECT` on `audit` and `platform_audit`. A registry role is used only for global tables and for the superadmin's cross-tenant reads (0013 item 5, "the superadmin overview uses a separate role") | The audit log is append-only by grant, not just by code. A request on a tenant's hostname can never use the cross-tenant role |
| D5 | The module resolves its own tenant from the `Host` by reading its tables, with the same rules as the kit (exact, lowercase, port dropped, `active` only; the platform hostnames and the IP-mode demo carve-out). It does not call itself over HTTP. It also serves `GET /internal/tenants/resolve` for the kit. One function serves both | One source of rules; the kit's `TenantResolver` tests run against the real endpoint shape |
| D6 | Superadmin paths answer 404 `not_found` on any host other than `CANCCU_SUPERADMIN_HOSTNAME`, before any auth check | Contract, Superadmin; a tenant hostname learns nothing |
| D7 | Every write runs in one transaction: change, `revision` +1, audit entry. The bus event is published after the commit | The audit entry cannot be lost while the change is kept. An event for a rolled-back change is never sent |
| D8 | Timers (the IP check's switch back, the hostname hold expiry, `presence_delete_at`) run in a loop in each container. A row is claimed with `FOR UPDATE SKIP LOCKED`, and its due time is also checked on every read. The IP check counts as on once `disabled_until` has passed, even when the timer is late | Containers keep no state and may run more than once; the kit's `check_screen_access` already treats a past `disabled_until` as on |
| D9 | Custom hostname verification uses `dnspython` behind a small `TxtLookup` interface, faked in the tests | The verify step is a DNS read; tests stay offline |
| D10 | Floor plans go through the kit's `platform_files_dir("tenants")` and `tenant_file("tenants", …)`. The type is checked by magic bytes (PNG, JPEG, WebP), with a 10 MB limit and no SVG | Contract, Venue profile; uploads are served as data (0013 item 21) |
| D11 | Leak tests use `canccu_kit.testing.assert_tenant_isolation` against the real Postgres, with two tenants and every per-tenant table. They run in the module's integration job in CI, next to `integration (kit)` | Acceptance criterion 4 |
| D12 | The demo seed is a module command, `python -m canccu_tenants seed-demo`, run by a one-shot Compose service before the module starts. It is idempotent and creates the tenant `demo` (`draft` → `live`) and the venue `demo-venue` with documentation addresses (`192.0.2.0/24`, `2001:db8::/32`) and loopback. The demo profile in `events/demo/` gives the names | It replaces `new-event` (#12) without touching `setup/` (high risk, privileged), and CI and the VM seed the same way |
| D13 | Adding a CI job touches `.github/workflows/ci.yml` | It is high risk anyway (tenancy code), so the risk class does not move |

## Questions
Question: **Q1, scope.** Should #50 be built as one PR of about 5,000 lines, or should the lead re-scope it? **Recommendation:** re-scope into two packages. #50 keeps A, B, C, D, G and I: the registry, hostnames, `resolve` and `ask`, the current tenant, status, flags, the IP check, venues and venue info, the audit log, the seed and the leak tests (about 3,400 lines, all of it needed by #51 and the kit). A new issue gets E, F and H: users, superadmins, admins, members, `me`, privacy, support, series and clone, retention and deletion (about 1,600 lines). It is blocked by #52, because all of it needs the tenant-bound session. The split follows the dependency on #52, not the line count.

Question: **Q2, who is the caller before #52.** **Recommendation:** the tenants module learns the caller only through the kit's `RightsChecker`, against admin's `GET /api/admin/session`, and takes `session.user.id` as the tenants user id. Role checks (event admin, superadmin, the role-only rights) read the tenants module's own tables by that id. A non-role right is granted when the user holds the event-admin role or admin's session lists the right. #52 then makes the sign-in upsert the user in the tenants module, so the ids agree. It adds that write endpoint to the contract, a contract PR that only adds. Until #52, the only users are the ones the seed or the superadmin command creates, so on the VM the session-gated endpoints answer 401 or 403 as the contract says. They are covered by tests with a fake session.

Question: **Q3, the first superadmin and the demo admins.** The contract says the first superadmin is set "from a shell on the VM (setup)". **Recommendation:** a module command, `python -m canccu_tenants superadmin add --discord-id <id> --name <name>`, run with `docker compose exec`. It writes the user with `mfa_enabled: false` until sign-in reports it, so the superadmin paths stay closed until #52. No `setup/` script in this package.

Question: **Q4, flag declarations.** The contract says a module "declares [its flags] next to its settings" and that an undeclared flag is 400 `unknown_flag`. No module declares flags yet, and the tenants module may not read other modules' files. **Recommendation:** the tenants module reads one file, `contracts/flags.yaml` (a list of `<module>.<feature>` with defaults), copied into its image. It starts empty, so every `PUT` with a flag is 400 `unknown_flag` until a module's contract PR adds its flags. Creating that file is an additive contract change, so it goes in its own small PR first. Alternative: modules register their flags at start on an internal endpoint. That is more moving parts and would also need the contract.

Question: **Q5, the IP-mode Caddy route.** The issue's Out of scope says "Caddy", but the module needs `handle /api/tenants/*` in `deploy/Caddyfile`, the IP-mode one, for its public paths and the demo-stack screenshots. **Recommendation:** add the route, one block in the same shape as admin's. The edge Caddy, the TLS and the `ask` wiring stay in #51.

## After the answers
The worker builds the scope the answers settle on this branch, in the order A, B, G, C, D, I. Each area is test-first, against the real Postgres for RLS and the audit grants. Then come the module checks (`ruff`, `mypy`, `pytest`), `scripts/check-tenancy`, `scripts/check-naming`, `scripts/check-file-size` and the demo stack. No file goes over about 400 lines: routes are split by area (`registry.py`, `hostnames.py`, `current.py`, `venues.py`, `audit.py`, …).
