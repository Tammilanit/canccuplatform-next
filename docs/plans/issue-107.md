# Plan: issue #107 — devices, zones and assignments

Package `screen-devices-zones`, branch `107-feat-screen-devices-zones`. Step 3, wave 1 of the package plan. Sources of truth: `contracts/screen.md` with `contracts/screen.openapi.yaml` and `contracts/screen/devices.openapi.yaml` as merged in #201, [0028](../decisions/0028-pairing-sets-a-new-devices-event.md) (#183), the step 3 final plan (`docs/briefs/step-3-screen.md`, `## Plan`), and the kit as on main at 09c28f9. This plan changes no contract; it names the contract gaps the lead has to settle first.

## Why a plan first
1. **Size.** A full build with tests is about 5,500 changed lines (estimate below), more than three times the package limit of about 1,500 ([AGENTS.md](../../AGENTS.md#how-work-flows)). Workers may not split an issue, so the lead decides how to split it.
2. **Contract gaps.** Five of the issue's criteria need something no contract offers yet (table below): reading another event by id, recognising the superadmin, granting rights, and two health flags with nothing to compute them from. Under the contract rules each gap is closed in its own PR, merged before any code uses it.
3. **No screen module yet.** `modules/screen/` is empty on main. #108's plan (PR #205) also proposes to create it; the two plans have to agree who builds the skeleton.
4. **CI is `.github/`.** CI runs each module's checks by name (`.github/workflows/ci.yml`). Without a CI change the screen module's tests, including the cross-event leak tests this issue asks for, never run in CI.

## Contract gaps
| # | Criterion | What is missing | Proposed additive change |
|---|---|---|---|
| G1 | Moving devices; the device's home URL | Screen must check that the target event's venue is the device's venue, and must know the current event's primary hostname for `GET /api/screen/device/home`. The tenants internal API resolves by hostname only (`/internal/tenants/resolve?host=`); nothing answers by tenant id | `GET /internal/tenants/tenants/{tenant_id}` → `TenantContext` (service identity, as `resolve`) |
| G2 | The superadmin registry (`/api/screen/registry/*`) | A module cannot tell a superadmin session: `Session` (admin.openapi.yaml) has no superadmin flag, and `GET /api/tenants/me` is per event. The registry needs "superadmin with `mfa_enabled`, on the superadmin hostname" | `Session.superadmin` (boolean; true only for a platform-bound session whose identity has `mfa_enabled`), read by the kit's `RightsChecker` as `requireSuperadmin` |
| G3 | The "screen crew" preset, granted in one action | admin's contract has the right `admin.rights.write` and the event `admin.rights.changed`, but no path that grants or lists a member's rights | `GET`, `PUT /api/admin/rights/{user_id}` (the full list, `admin.rights.write`, audited) and `GET /api/admin/rights/presets` naming `screen_crew` with its list; Studio's one action is one `PUT` |
| G4 | The clock-offset flag (over 2 s) | The heartbeat carries no device time, so the server cannot know the offset; `DeviceHealth` has no field for it | `Heartbeat.client_time`; `DeviceHealth.clock_offset_ms` and `DeviceHealth.flags` (`clock_drift`) |
| G5 | The flag for one token used by two viewports at once | Two kiosks with one copied cookie send the same token; nothing in a heartbeat tells two page loads apart | `Heartbeat.instance_id` (random per page load); flag `shared_token` in `DeviceHealth.flags` |

Not a gap, but to settle: the QR on the kiosk opens "Studio's pair dialog … code in the URL fragment". Studio's routes are #189's and the kiosk frame is #109's; both can use one fixed address, `/admin/screen/devices#pair=<code>`, written into the contract as a sentence (or `Pairing.pair_url` if the lead prefers a field). The issue lists the preset as `screen.devices.*`, `screen.ticker.write` and `agenda.items.write`; the contract adds `agenda.crew.read` (a delay moves crew items too). This plan follows the contract.

## Size by area (source plus tests, estimated)
| Area | Lines |
|---|---|
| A. Module skeleton: Fastify on `@canccu/kit`, `pg`, a `runMigrations` in kit-ts, Dockerfile, Compose service, Caddy routes, README, health (`postgres`, `valkey`), settings declaration (`heartbeat_seconds`, `offline_after_seconds`) | 600 |
| B. Devices and pairing: the global `devices` table; start, poll, claim and clear pairing with the limits and both cookies; the device check with the contract's codes; list, rename, revoke; audit; events | 1,400 |
| C. Zones (with epoch, revision, the `main` zone, sound device), assignments, mirroring, parked devices, `zone_in_use`, commands `reload` and `identify` | 1,300 |
| D. Moving: the registry, transfer codes, superseded tokens, `device/home`, `device/transfer`, released and moved events, no dangling references on move, revoke and delete | 1,200 |
| E. Heartbeat and health: online and offline, `playing_changed` at most every 10 s, state lag, the clock-drift and shared-token flags | 700 |
| F. The screen crew preset in admin (Python), once G3 is in the contract | 300 |
| **Total** (each area carries its own cross-event leak tests) | **≈ 5,500** |

## Design (holds for every split)
| # | Decision | Reason |
|---|---|---|
| D1 | **TypeScript:** Node 22, Fastify 5, `pg`, vitest, on `@canccu/kit` and `@canccu/kit/fastify`, the pins and lint setup of `modules/hello` | [0006](../decisions/0006-stack.md); the same choice as #108's plan, so one module has one stack |
| D2 | **Migrations** through a `runMigrations` in kit-ts that behaves like kit-py's `run_migrations` (ledger `screen_migrations`, advisory lock, app role, grant to the login role) | kit-ts has none; #108 and agenda need the same runner |
| D3 | **Tables.** Global `devices`, exactly the contract's columns (`superseded_token_hashes` as `jsonb`, each `{hash, expires_at}`); it is already on `scripts/tenancy-global-tables.txt` as `screen devices`. The ledger `screen_migrations` gets its line there, as admin's and tenants' have. Per tenant under RLS: `screen_zones` (`key`, `name`, `layout_id`, `regions`, `sound`, `revision`, `epoch`), `screen_assignments` (`device_id`, `zone_key` or a mirror target, `paired_at`) | 0013 items 5–7 and 34: nothing of an event on the global row |
| D4 | **One gate for event routes:** every `/api/screen/devices/{device_id}…` handler loads the device through one function that matches `current_tenant_id` to the request's tenant and answers 404 `not_found` otherwise; the global table has no RLS, so this function is the only reader on event routes, and a leak test drives every route through it | The contract's "event routes see only the event's devices" |
| D5 | **The device check** runs as one preHandler, in the contract's order: unknown or revoked token → 401 `device_unknown`; superseded token → 409 `device_moved` (except `device/home`); another current tenant or none → 409 `device_moved`; not from the venue (unless the emergency switch is off, through the kit's `venueIpCheckActive`) → 403 `venue_ip_refused`. A refused answer carries a `message` the kiosk shows as the crew's next step | Screen answers devices with the contract's codes; the kit's `device_token_invalid` and `venue_ip_mismatch` are renamed in the kit later (question 5) |
| D6 | **Short-lived things live in Valkey** under `tenantKey("screen", …)`: pairing codes (10 minutes, the pairing cookie's secret stored as its hash, open-code counts per event and per address), transfer codes (60 seconds, `GETDEL` for single use, in the new event's keys), commands (per device, 60 seconds), health (last heartbeat, open streams, instance ids). Postgres holds devices, zones and assignments | Containers keep no state; a heartbeat every 15 seconds from 100 screens writes nothing to Postgres |
| D7 | **Superseded tokens** are kept as hashes with their expiry, 7 days after the transfer; the first request that the new token passes drops them; revoking or deleting drops them all | The contract's Moving rules; a copied old cookie never gets a code or a token |
| D8 | **The `main` zone** (with `regions.hero.idle: next`) is created on `tenants.tenant.created`, and, so a missed event never leaves an event without zones, also on the first zone read or pairing of a tenant that never had one (a per-tenant marker, so a deleted `main` is not created again) | The contract's "a new event starts with one zone, `main`"; the kit's bus has no consumer groups yet |
| D9 | **`zone_in_use`** asks a list of checks: devices assigned or mirroring here; #108 adds its windows, pushes and break playlists to the list | The contract names all five; #108 owns three of them |
| D10 | **No dangling references:** moving away, revoking and deleting a device run one function, in the same transaction, that unassigns the devices mirroring it (each emits `screen.device.assigned`) and sets a zone's `sound.device_id` naming it to `null` (emits `screen.zone.saved`) | One place for the rule, so each path tests the same code |
| D11 | **Online:** a heartbeat or an open stream within `offline_after_seconds`; a sweep every 5 seconds, one container at a time under a Valkey lock, emits `screen.device.offline`. `clock_drift` when `abs(server receive time − client_time)` minus half the request's round trip is over 2 seconds; `shared_token` when two `instance_id`s report for one token within one heartbeat interval | E3 and E10 of the final plan; the stream itself is #109's and reports "open" through the same Valkey key |
| D12 | **Superadmin routes** answer only on the superadmin hostname (`installTenancy` with `platformHosts: "serve"`, the registry checks the host) and only for `Session.superadmin` (G2); elsewhere 404 | The contract's registry rules |
| D13 | **Audit** in the request, through `POST /internal/tenants/audit` with the service identity: pairing, rename, assignment, move, transfer, revoke, delete. An archived event's writes get 409 `event_archived` | The contract's Audit list |
| D14 | **Out of this issue:** the zone preview (needs #109's composed-state builder), the `/screen/` page and its frames (#109), the stream that delivers commands (#109), Studio (#189) | The issue's Out of scope |

## Proposed split (for the lead)
Each slice is one issue and one package of about 1,500 lines or less.

| Slice | Content | Risk | Needs |
|---|---|---|---|
| 0. Contracts | G1 (tenants), G2 and G3 (admin), G4 and G5 (screen), and the pair-dialog address; additive, so normal ([0024](../decisions/0024-additive-contract-docs-normal-risk.md)); may be one PR per contract | normal | — |
| A. Skeleton | D1, D2, health, Compose and Caddy; shared with #108's slice A + B (one of the two builds it) | normal | — |
| B. Devices and pairing | Area B, with its leak tests | high (device tokens, cookies, venue address check) | A |
| C. Zones and assignments | Area C, with its leak tests | high (tenancy of devices) | B |
| D. Moving | Area D, with its leak tests | high (tokens, cross-event moves, superadmin) | C, G1, G2 |
| E. Heartbeat and health | Area E | normal | B, G4, G5 |
| F. Screen crew preset | Area F in admin | high (rights) | G3 |
| CI | The screen module's checks and Postgres tests in `ci.yml`; shared with #108's CI slice | high (`.github/`) | A |

Order: 0 and A first, then B → C → D, with E and F once their contract parts are merged. The issue's criteria map as: pairing → B (the QR's address from 0); access and the emergency switch → B; zones, assignments, mirroring, parked devices, dangling references → C and D; moving → D; preset → F; commands → C; heartbeat and flags → E; leak tests → B, C, D, E.

## Questions
1. **Split:** split #107 into the slices above, or keep one issue far over the limit? Recommendation: split.
2. **Contract gaps:** open the slice-0 contract issues for G1–G5 as proposed? Recommendation: yes, before B; B and C need none of them, so they can start at once.
3. **The skeleton:** does #107's slice A or #108's slice A + B build `modules/screen/` and the kit's migration runner? Recommendation: #107's, since zones come first and #108's persistence waits for them.
4. **The pair dialog's address:** a fixed sentence in the contract (`/admin/screen/devices#pair=<code>`) or a `Pairing.pair_url` field? Recommendation: the sentence; the kiosk then needs no new field.
5. **Kit codes:** rename the kit's `device_token_invalid` and `venue_ip_mismatch` to the contract's `device_unknown` and `venue_ip_refused` (kit-ts and kit-py) in slice B, or later? Recommendation: in slice B, as the contract says the kit takes them over.
6. **CI:** one CI slice for the screen module, or a generic step for every module with checks (as #108's plan asks)? Recommendation: the generic step, once.

## After the answers
The lead rewrites #107 and opens the slice issues as the answers decide; each slice then runs as a package against this plan's design table.
