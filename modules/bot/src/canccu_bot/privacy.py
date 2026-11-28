"""The opt-out filter's one seam (D3 of docs/plans/issue-122.md): the Discord ids of the event's
members who hid their activity (`presence_opt_out`, contracts/tenants.md, Privacy and retention).
Every count leaves them out when it is built, so opting out holds from the next count.

Until #150 serves the flag nobody can set it, so this answers the empty set; and until then no
output names anyone (the lead's answer 2). Link 2b of #122 replaces it with admin's read of people
by Discord id."""

from __future__ import annotations


async def hidden_discord_ids(tenant: str) -> frozenset[str]:
    del tenant
    return frozenset()
