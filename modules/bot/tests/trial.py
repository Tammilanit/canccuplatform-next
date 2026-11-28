"""`/trial`: the framework's test command, shaped like `/finals` (What `/finals` needs, step 6
plan) without being it. Tests only: no flag of the platform registers it."""

from __future__ import annotations

from datetime import datetime

from canccu_bot.components import Component
from canccu_bot.framework import (
    Button,
    Command,
    Context,
    Field,
    Form,
    Option,
    Reply,
    Subcommand,
)

FLAG = "bot.trial"
PROVIDER = "https://finals.example.test/api"


async def run(c: Context) -> Reply:
    if c.subcommand == "announce":
        await c.act("moments", "POST", "/api/moments/announcements", {"text": c.options["text"]})
        return Reply(embeds=[{"title": f"Sent to {c.event_name}"}])
    season = await c.provider("finals", "GET", f"{PROVIDER}/status", None)
    return Reply(
        f"{season['name']}: registration open",
        buttons=[
            Button("Open the page", url=season["url"], style="link"),
            Button("Register", step="register", args=season["id"]),
            Button("Another name", step="rename", args=season["id"], style="secondary"),
        ],
        expires_at=datetime.fromisoformat(season["expires_at"]),
    )


async def on_component(c: Context, component: Component, values: dict[str, str]) -> Reply:
    if component.step == "register":
        return Reply(
            "Register for this season?",
            buttons=[
                Button("Yes", step="yes", args=component.args),
                Button("No", step="no", style="secondary"),
            ],
        )
    if component.step == "no":
        return Reply("Nothing was sent.")
    name = values.get("name") or c.caller.nickname[:18]
    body = {"season": component.args, "discord_user_id": c.caller.user_id, "name": name}
    await c.provider("finals", "POST", f"{PROVIDER}/register", body)
    return Reply(f"Registered as {name}.")


def name_form(c: Context, component: Component | None) -> Form:
    field = Field("name", "Your name", value=c.caller.nickname[:18], max_length=18)
    return Form("named", "Register with a name", (field,), args=component.args if component else "")


TRIAL = Command(
    name="trial",
    flag=FLAG,
    description={"en": "Try the framework", "fi": "Kokeile kehystä"},
    names={"fi": "kokeilu"},
    run=run,
    subcommands=(
        Subcommand("status", {"en": "The season", "fi": "Kausi"}),
        Subcommand(
            "announce",
            {"en": "Announce", "fi": "Tiedota"},
            (Option("text", {"en": "What to say", "fi": "Mitä sanotaan"}, required=True),),
        ),
    ),
    on_component=on_component,
    forms={"rename": name_form},
    right_names={"moments.announce": {"en": "Announce", "fi": "Tiedotus"}},
    errors={
        "registration_closed": {
            "en": "Registration is closed.",
            "fi": "Ilmoittautuminen on suljettu.",
        }
    },
)
