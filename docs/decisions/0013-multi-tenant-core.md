# 0013. Multi-tenant from day 1, on one shared stack

- **Status:** Accepted
- **Date:** 2026-11-05

## Context
The hoster wants to run the platform for several organizers, possibly at the same time. The hoster's proposal: one app, one shared schema with `tenant_id` on every row, tenants resolved by hostname, superadmin and event admins, one central bot. A review proposed instead a stack per event plus a control plane. Nothing module-specific is built yet, so tenancy now costs a design decision, not a retrofit. RAM and disk are scarce, so one VM is the start.

## Decision
Follow the shared-stack model fully from day 1 and fix what the proposal missed. The stack-per-event and control-plane ideas are dropped. The plan's non-goal "many events at once" is replaced by **"multi-tenant from day 1: many events, also simultaneous, on one shared stack."**

### Core
1. **One VM, one shared stack:** one container per module, one Postgres, one Valkey, one edge Caddy. Every event is a tenant. Adding an event or a hostname adds rows (no deploy, no restart). Memory grows with modules, not events; disk is the real limit.
2. **Host-based tenant resolution** through the tenants registry. An unknown host gets nothing. Outside tenant resolution, and named here so no module invents its own bypass: the platform's own hostnames (the central sign-in host, item 10, and the superadmin hostname, item 13); health endpoints; and the IP-mode demo stack in CI, which serves the demo tenant on an unregistered host.
3. **Roles:** superadmin (global) and event admin (per tenant; a user can admin several events), checked in the backend.
4. **The tenants module and contract come first:** tenants, hostnames, admins and roles, venues and each event's venue (item 33), settings, feature flags, lifecycle (draft → live → archived; archived is read-only) and the audit log. The bus envelope gains `tenant`.

### Isolation
5. **Postgres row-level security on every tenant table.** The app role owns no tables and has no BYPASSRLS. The kit sets the tenant with `SET LOCAL` per transaction, never per connection. With no tenant set a query sees nothing. A column default reads the tenant setting. The superadmin overview uses a separate role.
6. **The tenant is in every key.** Unique constraints include `tenant_id`; foreign keys are composite with it, so a row cannot reference another tenant's row. CI lints every table for the column, the policy and the keys. Global tables (tenants, hostnames, venues, users) have no `tenant_id`; they are exempt only through an explicit allow-list that the lint enforces, and a new global table needs a change to that list.
7. **Kit scoping beyond Postgres:** Valkey keys and bus streams per tenant (`t:<tenant>:events:<module>`); files under `/files/<tenant>/<module>/`, served only after a tenant check; caches and schedulers keyed by tenant; bus consumers set the tenant per message and pick up a new tenant's streams without a restart (item 1). Modules use no raw keys.
8. **Cross-tenant leak tests** for every endpoint and consumer, in CI.

### Web, sign-in, TLS
9. **TLS:** a wildcard certificate via DNS-01 for `*.<platform domain>` (Caddy built with the DNS provider plugin); Caddy on-demand TLS for custom hostnames, always behind the `ask` endpoint backed by the registry; 80/443 open to everyone once HTTPS and sign-in exist.
10. **One central sign-in host** with the Discord OAuth app, handing each tenant hostname a one-time code (Discord allows only about 10 redirect URIs). Cookies are host-only and `Secure`; each session is bound to one tenant server-side; absolute URLs come from the registered hostname, never the `Host` header; Fastify `trustProxy` trusts only Caddy.
11. **Access:** info views are read-only and public by default, with a per-tenant mode (item 33); screens and projectors pair once and get a revocable device token; admin always needs sign-in. Venue IP addresses (CIDR, IPv4 and IPv6, as the remote VM sees them, i.e. the venue's public NAT or prefix) are only a soft hint for people, never authorization: this holds for all rights and for admin. For screens the venue IP is a required second factor next to the pairing token, never sufficient alone (item 33).
12. **Proof of ownership:** binding a guild needs Manage Server on it, through the OAuth bot-install flow; a custom domain needs a DNS TXT record first; a removed hostname is held for a while before reuse.
13. **Superadmin hardening:** Discord 2FA required (`mfa_enabled`); superadmin works on a separate admin hostname; support access to a tenant is audited; the audit log is append-only and covers settings, roles, hostnames, venues and their addresses, the venue IP-check switch, bot bindings and secret changes.

### Discord
14. **One bot module, a pool of clients.** The default is the shared platform bot in many guilds. From day 1 a tenant can set its own application id and token (encrypted), and the module opens a separate client for it. A crashed or rate-limited client restarts on its own; one guild's error never affects another. Never run a legacy bot and the new bot on one token at once.
15. **Slash commands are registered per guild** from the tenant's feature flags and re-registered on change; handlers check the flag too.
16. **Privileged intents** (members, message content, presence) are app-wide. On the shared bot, data from tenants without the feature is dropped, never stored. The intents needed are decided when canccubot is ported.

### Customization per event
17. **Feature flags per tenant.**
18. **Settings per tenant per module:** each module publishes a settings schema in its contract; admin builds the forms from it; a change is a bus event, with no restart.
19. **Full design per tenant:** a theme package (CSS, fonts, images, tokens) uploaded or synced from the event's git repo; screen layouts as data (regions, widgets, rotation); per-tenant widget templates in a logic-less template language; draft → preview → publish, with rollback.
20. **Theming contract:** stable CSS classes and custom properties. CI screenshots the demo tenant's themes on every change.
21. **Upload safety:** SVG and HTML are served sandboxed; a strict CSP keeps tenant assets on the tenant's own host; custom JS runs only in a sandboxed iframe on a separate origin.

### Operating one shared version
22. **Releases:** additive-only migrations (expand/contract) with `lock_timeout` and online patterns; the later contract (drop) step is its own destructive migration and needs a person's approval (AGENTS.md, Migrations); deploys are blocked while any tenant is live, except hotfixes; a demo tenant gets every change first.
23. **Per-tenant pinned screen version:** the screen and public frontends are static bundles, several versions are kept, and a tenant can pin the one it tested. APIs stay backward-compatible through additive contracts.
24. **A staging stack on the same VM,** run only while testing a release, with a copy of the demo tenant; stopped otherwise.
25. **Offline-capable screens:** they cache their last state and assets and keep running when the venue uplink drops; admin shows the offline state.
26. **Backups off the VM:** nightly database (with PITR) and file backups to another host; a restore tested monthly; per-tenant export and import, also for restoring one event and for archiving.

### Fairness, data, operations
27. **Per-tenant limits:** rate limits, storage quotas, video size limits, and fair job queues for heavy work (PPTX, TTS, uploads).
28. **Observability:** logs and metrics tagged with the tenant, and a status view per tenant.
29. **Secrets:** encrypted at rest with a key outside the database (in `deploy/.env`), rotatable, never returned to the frontend.
30. **Users are global.** An event admin sees only their own event's members.
31. **GDPR:** deleting a tenant or user covers rows, Valkey, files and logs, plus a stated backup retention period.
32. **A written data-processing agreement with each outside organizer:** who holds the data, deletion and uptime expectations. An organizational task for the operators, not code.

### Venues and screens
33. **Venues as an entity.**
    - A venue has a name, its IPv4 and IPv6 addresses (as the VM sees them), and the devices that stay at the venue.
    - An event points to a venue. Several events can use the same venue, at different times or at once.
    - Venues are global rows managed by the superadmin. Assigning a venue's devices to an event is tenant-scoped.
    - A screen needs **both** a request from its event's venue IP **and** its pairing token. The VM sees only the venue's public IP, and events at one venue share it, so the check is in the app; the firewall cannot tell events apart.
    - A per-tenant switch turns the venue IP check off in an emergency (for example when the venue's address changes mid-event). Every use is audited (item 13).
    - Info pages are public by default; each tenant chooses a mode: public, venue-only (from the venue IP) or sign-in. Venue-only is a visibility setting for public, read-only info pages, never authorization for anything else; attendees of another event at the same venue can see them too.
34. **Multiple screens per event.**
    - Devices are paired and named.
    - Each event has zones (for example main hall, café, stage), each with its own layout, playlist and schedule.
    - Devices are assigned to zones per event and can be reassigned for the next event.
    - Admin can push to all zones or one zone, and mirror one zone onto others.
    - Admin shows each device's health: online, last seen, now playing.

## Consequences
- The roadmap gains a tenancy-foundation step before the event catalog and screen contracts, preceded by a legacy inventory ([roadmap step 2](../roadmap.md#2-event-catalog-and-contracts)).
- Setup (#12): `new-event` becomes "seed the demo tenant" (tenants are rows created through the tenants module, item 1) and the stack is one; the firewall covers IPv6 and 443 and later opens 80/443 to all.
- Caddy (#9's follow-up) becomes the single edge Caddy with the DNS plugin, on-demand TLS and `ask`.
- The event catalog (#34) and screen contract (#35) are tenant-aware; #35 gets pairing tokens, the venue IP check, devices, zones and assignments, layouts as data, the theming contract and pinned bundles.
- The admin module assumes one event (`admin_settings` keyed by module, a singleton `admin_profile`) and is reworked for tenants.
- The kit gains tenant context, RLS helpers, scoped keys, streams and files, and a migration lint.
- Each port costs more (every table, key, timer, cache and subscription scoped, plus leak tests). One missed scope shows one organizer's data to another, so the lints and leak tests are required checks.
- All tenants share one version and one migration; restoring one event uses the per-tenant export, not PITR.
- The kit-tenancy and edge-Caddy child issues implement the carve-outs named in items 2 and 6.
- A legacy bot is cut over at the switch: its data is migrated into its event's tenant, the legacy bot is stopped, its token goes into the tenant, and the old container is kept stopped as rollback.
