"""The opt-out filter's one seam (docs/plans/issue-122.md, D3 and the lead's answer 2).

Someone who hid their activity (`presence_opt_out`, contracts/tenants.md, Privacy and retention)
is never counted or listed, from the next read, in any output (E7). Every count is built from the
live state minus this set, at the moment it is built, and a message's author is checked against it
before the message is counted.

Until #150 serves the flag nobody can set it, so the set is empty; no output of the bot carries a
name before then (D9). Link 2b (the Go-public track, blocked on #150) replaces this function with
the people-by-Discord-id read (C1) and drops a person's live entries at once on
`tenants.privacy.changed`."""

from __future__ import annotations


async def hidden_discord_ids(tenant: str) -> frozenset[str]:
    """The Discord ids of the event's members who hid their activity."""
    del tenant
    return frozenset()
