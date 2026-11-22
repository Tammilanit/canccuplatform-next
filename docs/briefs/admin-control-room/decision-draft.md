# Draft: settings live in their modules, and every module can be switched off

A draft decision record for the [admin control-room pack](../admin-control-room.md). It is not in `docs/decisions/` yet: after the session the lead files it there with the next number, changed by the plan.

- **Status:** Draft (for the session on [#734](https://github.com/Tammilanit/canccuplatform-next/issues/734))
- **Date:** 2026-11-22

## Context
Admin grew at the kit level from step 2's design: one Settings page that lists every module's settings as forms generated from their declarations, and no home (`/admin` redirects to the first page a person may open). Every module is always on; the tenants module's feature flags exist, but only two are declared, both inside Screen.

The product owner's first look at admin on the dev server (2026-11-21): the settings of Food and the other modules sit on one admin page instead of with their module, there is no way to switch modules on or off, and the purpose of `/admin` is unclear. On 2026-11-22 the product owner and the lead agreed a base: admin is the event's control room, with two homes, settings in their modules and a switch per module.

## Decision
1. **Settings live in their modules.** Each module's settings are a Settings tab on its own page (Food → Settings, Screen studio → Settings, Run of show → Settings, Notifications → Settings, Games → Settings). Admin keeps only the event's basics: name, dates, time zone, language, venue, look and access, on one Event basics page. The admin Settings page goes; its addresses redirect to the module's tab.
   - **Only the page moves.** The values stay in admin's store and are read and written through `GET` and `PUT /api/admin/settings/{module}`, drawn by the kit's settings form from the same declarations. Profiles, `admin.settings.changed` and the rights (`admin.settings.read` and `.write`) stay as they are.
2. **Every module can be switched on and off.** Each module has one feature flag, `<module>.enabled`, in [`contracts/flags.yaml`](../../../contracts/flags.yaml), on by default, set through the tenants module's flags API (right `tenants.flags.write`) and announced by `tenants.flags.changed`. The run of show, admin, the tenants core and theming have no switch.
   - **Off means:** the module's pages leave the organiser menu and the hub and answer "not at this event"; its items stay in the run of show but its scheduled actions stop (reminders, auto-closes, moments); its screen widgets hide; the bot drops its commands for the event.
   - **Off never deletes.** Every piece of the module's data stays; switching it on brings the module back as it was. Live work (an open order, a running session) stays as it is, hidden.
   - The Modules page asks before switching off and names the live work.
3. **Admin opens on the event.** `/admin` is the organiser control center for event admins and the crew desk for crew; both are built on the run of show, the event's one schedule.

## Consequences
- **Contracts:** additive only. `flags.yaml` gains one flag per switchable module, each module's contract lists its flag, and each module honours it; each part that has a tile on the control center adds one small status read. Each ships with the code that uses it ([0029](../../decisions/0029-additive-contracts-ship-with-consumers.md)).
- **The design:** [`experience-map.md`](../../design/experience-map.md#where-each-setting-lives) "Where each setting lives" names each module's Settings tab and admin's Event basics.
- **Built modules:** each moves its settings into its own tab and honours its switch in its own step's polish; Food first, in step 5's polish.
- **The kit:** the settings form becomes a kit component any module's page draws; the shared menu hides switched-off modules.
- **Not changed:** who may change settings (organisers, `admin.settings.write`); a right per module to change its own settings is a later, additive choice.
