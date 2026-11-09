# Plan: issue #223 — the screen crew role preset

Package `admin-screen-crew-preset`, branch `223-feat-admin-the-screen`. Step 3, slice F of the accepted #107 plan ([issue-107.md](issue-107.md)). Sources of truth: `contracts/admin.md` (Granting rights) and `contracts/admin.openapi.yaml` as merged in #231 (G3), `contracts/screen.md` (Rights), `contracts/tenants.md` (Users, roles and membership), and admin, tenants and the kit as on main at 08e74bc. This plan changes no contract and no code. It names what the slice needs that main does not have yet, so the lead can settle it first.

## Why a plan first
The #107 plan gave slice F one dependency, G3, which is now merged. Three more facts on main stop the slice from meeting the contract:

1. **Admin cannot learn whether the target user is a member, or an event admin.** `GET`/`PUT /api/admin/rights/{user_id}` answer 404 `not_found` for a user who is not a member of the event, and report `event_admin`. Membership is the tenants module's (#150, open): main has no members, no `GET /api/tenants/me`, no `GET /api/tenants/current/admins`, no `/internal/tenants/users/{user_id}` and no `tenants.member.*` events. Even once #150 lands, no contract path lets a module ask about *another* user. The user-facing paths need `tenants.members.read`, which a holder of `admin.rights.write` may not have. Events are the only other source, and the kit reads them from `$` (`Bus.subscribe_tenants`), so admin loses whatever happens while it restarts. A rights check built on that is not safe.
2. **Admin cannot tell whether the caller is an event admin of the request's event.** The `PUT` needs the caller to "hold every right the change adds or removes", and an event admin holds every right. Admin's sessions carry only its own global roles (`ROLE_RIGHTS` in `auth.py`: owner and admin, `admin.*` rights only). So today even the owner lacks `screen.devices.read` and could not grant `screen_crew`. The event-admin role lives in the tenants module's `event_admins`, and admin can read it only through the same missing path as in point 1.
3. **A granted right reaches no session until sessions are bound to a tenant (#52, open).** A session's `rights` should be the role's plus those granted in the session's event. Admin's sessions have no tenant (`admin_sessions`), and modules call `GET /api/admin/session` on `admin:8080`, where no hostname names one. Without #52, a grant is stored and audited but no module sees it.

Building the slice anyway would mean making up a membership rule in high-risk rights code (for example "every user admin has seen is a member"). That is a contract decision, outside a worker's Room to design ([AGENTS.md](../../AGENTS.md#issues)).

## Proposed contract gap
| # | What is missing | Proposed additive change |
|---|---|---|
| G6 | A module asks whether a user is a member of an event and holds its event-admin role | `GET /internal/tenants/tenants/{tenant_id}/users/{user_id}` → `{"member", "event_admin"}` (service identity, like `GET /internal/tenants/tenants/{tenant_id}`); an unknown user answers both `false`, never 404, so the answer does not tell which user ids exist. Built by the tenants module with #150 |

## Design (once G6 and #150 are in)
| # | Decision | Reason |
|---|---|---|
| F1 | **Table** `admin_tenant_rights (tenant_id, user_id, rights text[], rights_version integer)` under RLS, like `admin_tenant_settings`; migration `004_tenant_rights.sql`, additive. A list taken away is emptied, never deleted | The contract's `rights_version` keeps counting across leaving and rejoining |
| F2 | **Presets** as code: `PRESETS = {"screen_crew": ("screen", [...6 rights])}` in `rights.py`, with a test that reads the list in `contracts/screen.md` (Rights) and fails when the two differ | The contract names the list; a test keeps code and contract equal |
| F3 | **`PUT` checks, in order:** signed in → `admin.rights.write` (or event admin) → each right matches `<module>.<right>` (400 `invalid_request`) → no role-only right (400 `right_role_only`, the three from tenants.md) → G6 says member (404) → the caller holds every right in the symmetric difference of old and new (403 `missing_right`; event admin holds all) → event not `archived` (409 `event_archived`) → `UPDATE … WHERE rights_version = $sent` (409 `version_conflict`) | The contract's codes. Membership before the caller check, so a non-member is always 404 |
| F4 | **Audit before commit:** `POST /internal/tenants/audit` (action `admin.rights.changed`, `changes` old and new) inside the transaction; a failed append rolls the change back. Then `admin.rights.changed` goes to the tenant's stream, not the platform stream | "Audited in the same request"; the event concerns one event |
| F5 | **Granted rights count only while G6 says member.** The read that #52's session uses (`granted_rights(tenant_id, user_id)`) filters by membership, so a missed `tenants.member.left` can never leave rights on someone who left | Defence in depth against the kit's `$` reads (point 1) |
| F6 | **Following tenants:** `tenants.member.left` and `tenants.user.deleted` empty the list, raise `rights_version` and emit `admin.rights.changed` with `[]`; `tenants.admin.removed` changes nothing | The contract's Granting rights rules |
| F7 | **Tests:** every path with each code above; the preset round trip (`GET` presets, one `PUT`, then one right taken away alone); cross-tenant leak tests (a grant in event A is invisible and unchangeable from event B's hostname); the Postgres store under RLS in `test_store_pg.py` | As the slice's high risk asks |

About 450 changed lines with tests.

## Questions
1. **Membership lookup:** add G6 as proposed, as a contract PR before this slice and built by the tenants module with #150? Or does admin keep its own copy of membership from tenants events, with a durable cursor in the kit? Recommendation: G6. A synchronous answer cannot drift, and the kit has no durable cursor.
2. **Order:** block #223 on #150 and the G6 contract PR? Recommendation: yes. Nothing in the slice can return a correct 404 or `event_admin` before then.
3. **The session merge:** does #52 (which binds sessions to a tenant) add the granted rights to `GET /api/admin/session`, or a short slice after #52? Recommendation: #52, since that is where a session first knows its event. #223 leaves the `granted_rights` read (F5) for it, with tests.
4. **Owner and admin roles:** admin's global `owner` and `admin` roles predate tenancy. Until #52 replaces them, should `ROLE_RIGHTS` stay as it is, so only an event admin (through G6) can grant `screen_crew`? Recommendation: yes. A global role that holds every module's right would hold it in every event.

## Answers (the lead, 2026-11-09)
All four as recommended:
1. **Membership lookup:** G6 as proposed, as the contract issue #248. The tenants module serves it with #150.
2. **Order:** #223 is blocked by #150 and #248.
3. **The session merge:** #52 adds the granted rights to `GET /api/admin/session` (noted on #52). #223 builds the `granted_rights` read (F5), with its tests, and leaves the merge to #52.
4. **Owner and admin roles:** `ROLE_RIGHTS` stays as it is until #52. Only an event admin, as G6 reports, can grant `screen_crew`.

## After the answers
Once #248 and #150 are merged, #223 runs as one package against F1–F7. This plan's PR does not close #223.
