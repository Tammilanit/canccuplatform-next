"""The roles and the rights they hold: the one list of every right on the platform.

An event admin holds every right (contracts/admin.md, Granting rights; each module's contract,
Rights), so a module's right that is missing here refuses the event's owner. tests/
test_role_rights.py holds this list to every right the contracts, the shared menu and the modules'
code name, both ways. The event-admin role per tenant (contracts/tenants.md, Roles) replaces these
roles with the central sign-in (#52).
"""

from __future__ import annotations

RIGHTS_WRITE = "admin.rights.write"

EVENT_ADMIN_RIGHTS = frozenset(
    {
        # admin (RIGHTS_WRITE is the owner's alone, below)
        "admin.settings.read",
        "admin.settings.write",
        "admin.profile.read",
        "admin.profile.write",
        # The event's integrations: today the Food AI reader's provider key (contracts/pizza.md).
        "admin.integrations.write",
        # agenda
        "agenda.items.write",
        "agenda.crew.read",
        # bot
        "bot.connection.read",
        "bot.presence.read",
        # games
        "games.catalogue.moderate",
        # moments
        "moments.read",
        "moments.announce",
        "moments.take",
        "moments.scenes.take",
        "moments.emergency",
        "moments.settings.write",
        # notify
        "notify.checkin.display",
        "notify.topics.write",
        "notify.stats.read",
        # pizza
        "pizza.order.open",
        "pizza.order.manage",
        "pizza.menu.write",
        "pizza.record.read",
        # screen
        "screen.devices.read",
        "screen.devices.pair",
        "screen.devices.write",
        "screen.zones.write",
        "screen.content.read",
        "screen.content.write",
        "screen.push.write",
        "screen.ticker.write",
        "screen.photos.write",
        "screen.bundle.write",
        "screen.settings.read",
        # tenants (the tenants module still asks its own event-admin rows for the role-only ones)
        "tenants.event.write",
        "tenants.access.write",
        "tenants.lifecycle.write",
        "tenants.admins.write",
        "tenants.members.read",
        "tenants.members.write",
        "tenants.flags.write",
        "tenants.venue_info.write",
        "tenants.venue_ip_check.write",
        "tenants.audit.read",
        # theming
        "theming.theme.write",
        "theming.embeds.write",
        "theming.sync.write",
    }
)

ROLE_RIGHTS: dict[str, frozenset[str]] = {
    "owner": EVENT_ADMIN_RIGHTS | {RIGHTS_WRITE},
    "admin": EVENT_ADMIN_RIGHTS,
}
