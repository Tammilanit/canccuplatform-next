"""The fake Discord's OAuth2 side: client credentials, the bot-install code exchange, a user's
own reads with its bearer token, and the private answers to interactions."""

from __future__ import annotations

from canccu_kit.testing.discord import MANAGE_GUILD, FakeDiscord

API = "https://discord.test/api/v10"


def basic(app_id: str, secret: str) -> tuple[str, str]:
    return (app_id, secret)


async def test_client_credentials_need_the_applications_own_secret() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Own Bot")
    form = {"grant_type": "client_credentials", "scope": "identify"}
    async with fake.http_client() as http:
        ok = await http.post(f"{API}/oauth2/token", data=form, auth=(app.id, app.client_secret))
        bad = await http.post(f"{API}/oauth2/token", data=form, auth=(app.id, "wrong-secret"))
    assert ok.status_code == 200
    assert ok.json()["token_type"] == "Bearer"
    assert (bad.status_code, bad.json()["error"]) == (401, "invalid_client")


async def test_a_code_is_exchanged_once_for_the_user_and_the_guild_it_names() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Own Bot")
    user = fake.add_user("Organiser")
    guild = fake.add_guild("Demo Community", owner_id=user.id)
    code = fake.authorize(app.id, user.id, guild.id)
    assert app.id in guild.bots  # the install adds the bot
    form = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": "https://signin.example.test/api/bot/install/callback",
    }
    async with fake.http_client() as http:
        r = await http.post(f"{API}/oauth2/token", data=form, auth=(app.id, app.client_secret))
        again = await http.post(f"{API}/oauth2/token", data=form, auth=(app.id, app.client_secret))
        token = r.json()["access_token"]
        me = await http.get(f"{API}/users/@me", headers={"Authorization": f"Bearer {token}"})
        guilds = await http.get(
            f"{API}/users/@me/guilds", headers={"Authorization": f"Bearer {token}"}
        )
    assert r.status_code == 200
    assert r.json()["guild"]["id"] == guild.id
    assert (again.status_code, again.json()["error"]) == (400, "invalid_grant")
    assert me.json()["id"] == user.id
    assert guilds.json() == [
        {"id": guild.id, "name": "Demo Community", "owner": True, "permissions": "0"}
    ]


async def test_a_member_shows_their_permissions_in_their_guild_list() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Own Bot")
    user = fake.add_user("Crew")
    guild = fake.add_guild("Demo Community")
    fake.add_member(guild.id, user.id, permissions=MANAGE_GUILD)
    code = fake.authorize(app.id, user.id, guild.id)
    form = {"grant_type": "authorization_code", "code": code, "redirect_uri": "https://x.test/cb"}
    async with fake.http_client() as http:
        token = (
            await http.post(f"{API}/oauth2/token", data=form, auth=(app.id, app.client_secret))
        ).json()["access_token"]
        guilds = await http.get(
            f"{API}/users/@me/guilds", headers={"Authorization": f"Bearer {token}"}
        )
    assert guilds.json()[0]["owner"] is False
    assert int(guilds.json()[0]["permissions"]) & MANAGE_GUILD


async def test_a_code_for_another_application_or_secret_is_refused() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Own Bot")
    other = fake.add_application("Other Bot")
    user = fake.add_user("Organiser")
    guild = fake.add_guild("Demo Community", owner_id=user.id)
    code = fake.authorize(app.id, user.id, guild.id)
    form = {"grant_type": "authorization_code", "code": code, "redirect_uri": "https://x.test/cb"}
    async with fake.http_client() as http:
        r = await http.post(f"{API}/oauth2/token", data=form, auth=(other.id, other.client_secret))
    assert (r.status_code, r.json()["error"]) == (400, "invalid_grant")


async def test_an_unknown_bearer_token_is_401() -> None:
    fake = FakeDiscord()
    async with fake.http_client() as http:
        r = await http.get(f"{API}/users/@me/guilds", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


async def test_an_interaction_answer_is_kept() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Own Bot")
    body = {"type": 4, "data": {"content": "Not connected", "flags": 64}}
    async with fake.http_client() as http:
        r = await http.post(
            f"{API}/interactions/100000000000000009/tok-1/callback",
            json=body,
            headers={"Authorization": f"Bot {app.token}"},
        )
    assert r.status_code == 204
    assert fake.interaction_answers == [("100000000000000009", body)]
