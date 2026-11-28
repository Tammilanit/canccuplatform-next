"""The fake Discord as the CI container serves it: seeded from the environment, the gateway on a
real websocket, and the control paths the stack tests use."""

from __future__ import annotations

from starlette.testclient import TestClient

from canccu_kit.testing.discord.server import create_server

ENV = {
    "CANCCU_BOT_APPLICATION_ID": "100000000000000002",
    "CANCCU_BOT_TOKEN": "fake-shared-token-for-ci-only-0123456789-0123456789",
    "CANCCU_BOT_CLIENT_SECRET": "fake-shared-secret-ci",
    "CANCCU_FAKE_DISCORD_GATEWAY_URL": "ws://fake-discord:8080/gateway",
}


def test_the_shared_application_comes_from_the_environment() -> None:
    fake, app = create_server(ENV)
    shared = fake.applications["100000000000000002"]
    assert shared.token == ENV["CANCCU_BOT_TOKEN"]
    with TestClient(app) as client:
        r = client.get(
            "/api/v10/gateway/bot", headers={"Authorization": f"Bot {ENV['CANCCU_BOT_TOKEN']}"}
        )
        assert r.json()["url"] == "ws://fake-discord:8080/gateway"
        assert client.get("/health").status_code == 200


def test_a_bot_identifies_over_the_websocket_and_shows_in_sessions() -> None:
    _, app = create_server(ENV)
    with TestClient(app) as client, client.websocket_connect("/gateway?v=10&encoding=json") as ws:
        assert ws.receive_json()["op"] == 10
        ws.send_json({"op": 2, "d": {"token": ENV["CANCCU_BOT_TOKEN"], "intents": 1}})
        ready = ws.receive_json()
        assert ready["t"] == "READY"
        assert ws.receive_json()["t"] == "GUILD_CREATE"  # the seeded demo guild
        sessions = client.get("/_fake/sessions").json()
        assert sessions == {"100000000000000002": 1}
        r = client.post(
            "/_fake/dispatch",
            json={"application_id": "100000000000000002", "t": "GUILD_UPDATE", "d": {"id": "1"}},
        )
        assert r.json() == {"sent": 1}
        assert ws.receive_json()["t"] == "GUILD_UPDATE"


def test_without_the_environment_there_is_no_application() -> None:
    fake, _ = create_server({})
    assert fake.applications == {}


def test_a_guild_is_made_with_the_bot_in_it_and_its_own_role() -> None:
    """The Discord page's screenshots (#765) bind a guild the shared bot joined after it
    identified, so it never left it as a guild no event chose."""
    fake, app = create_server(ENV)
    with TestClient(app) as client:
        r = client.post(
            "/_fake/guilds",
            json={
                "name": "Demo Server",
                "application_id": "100000000000000002",
                "bot_permissions": 1 << 10,
                "channels": ["general"],
            },
        )
        guild = fake.guilds[r.json()["guild_id"]]
        assert guild.name == "Demo Server" and "100000000000000002" in guild.bots
        [role] = guild.bot_roles["100000000000000002"]
        assert (guild.roles[role]["permissions"], guild.roles[role]["managed"]) == ("1024", True)
        assert [c["name"] for c in guild.channels.values()] == ["general"]
        bad = client.post("/_fake/guilds", json={"name": "x", "application_id": "nope"})
        assert bad.status_code == 404
