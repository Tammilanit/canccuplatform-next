"""The bind's result page on the sign-in host (contracts/bot.md, Binding a guild, step 5): for a
state that names no event, and for an event with no primary hostname to go back to. One card in
the platform's front-door look, saying what happened and the next step, in plain words."""

from __future__ import annotations

from canccu_kit import ui
from starlette.responses import HTMLResponse

CSS = ("/admin/static/ui.css",)
"""Admin serves the platform's front doors on the sign-in host, and their stylesheet with them."""

START_AGAIN = "Start connecting the server again from the event's Discord page."
WORDS: dict[str, tuple[str, str, str]] = {
    "ok": ("ok", "Discord server connected", "The bot now serves the event's server."),
    "state_invalid": (
        "warn",
        "This link has run out",
        f"It works once, for 10 minutes. {START_AGAIN}",
    ),
    "access_denied": ("info", "Discord was closed before it said yes", START_AGAIN),
    "discord_user_mismatch": (
        "warn",
        "Another Discord account said yes",
        "Use the Discord account you sign in to the platform with, then start again.",
    ),
    "manage_server_required": (
        "warn",
        "You need Manage Server there",
        "Only the server's owner, or someone with Manage Server, can connect it.",
    ),
    "bot_not_in_guild": (
        "warn",
        "The bot is not in that server",
        f"Keep the bot in the server when Discord asks. {START_AGAIN}",
    ),
    "guild_bound": (
        "warn",
        "Already connected",
        "This event already has a server, or that server belongs to another event.",
    ),
    "event_archived": ("info", "The event has ended", "An ended event takes no new server."),
    "connection_changed": (
        "warn",
        "The event's bot changed meanwhile",
        f"Discord added the bot the event used before. {START_AGAIN}",
    ),
    "code_exchange_failed": (
        "down",
        "Discord did not confirm the install",
        f"{START_AGAIN} If it fails again, check the application's client secret.",
    ),
    "discord_unavailable": ("down", "Discord did not answer", "Try again in a moment."),
}


def result_page(outcome: str, status: int) -> HTMLResponse:
    kind, title, text = WORDS.get(outcome, WORDS["discord_unavailable"])
    card = ui.notice(kind, title, text)
    response = HTMLResponse(ui.front_page(title, card, css=CSS, centred=True), status_code=status)
    # The page shows a result, nothing to frame; and the URL held a state, so no referrer leaves.
    response.headers["content-security-policy"] = (
        "default-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self';"
        " frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    )
    response.headers["referrer-policy"] = "no-referrer"
    response.headers["cache-control"] = "no-store"
    return response
