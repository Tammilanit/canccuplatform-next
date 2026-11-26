"""The owners admin's pages call, faked: tenants' event API and Screen's zone list (#782)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import httpx


@dataclass
class FakeTenants:
    """Tenants' event API as admin's pages call it: `/api/tenants/current` (the full event while
    `full`, as to an event admin, else the public fields), its venue info, floor plan, flags,
    hostnames, venue, storage; `refuse` answers the next write, `down` paths never answer."""

    admin_access: str = "internet"
    screen_access: str = "internet"
    revision: int = 3
    full: bool = True
    refuse: tuple[int, str] | None = None
    seen: list[httpx.Request] = field(default_factory=list)
    down: set[str] = field(default_factory=set)
    status_of: dict[str, int] = field(default_factory=dict)
    event: dict[str, object] = field(
        default_factory=lambda: {
            "name": "Demo Event",
            "short_name": "Demo",
            "description": "A weekend of games.",
            "contact_user_id": None,
            "series_id": None,
            "time_zone": "Europe/Helsinki",
            "starts_at": "2026-12-04T15:00:00Z",
            "ends_at": "2026-12-06T12:00:00Z",
            "membership": "open",
            "info_page_mode": "public",
            "presence_delete_at": None,
        }
    )
    venue_info: dict[str, object] = field(
        default_factory=lambda: {
            "venue_id": "v-demo",
            "address": "1 Demo Street",
            "house_rules": "Be kind.",
            "wifi": [
                {"ssid": "Demo-Guest", "password": None, "note": None, "visibility": "public"}
            ],
            "floor_plan": None,
            "revision": 2,
        }
    )
    flags: dict[str, bool] = field(
        default_factory=lambda: {"pizza.enabled": True, "screen.photos": False, "screen.web": True}
    )
    flags_version: int = 4
    plan: tuple[str, bytes] | None = None

    def body(self) -> dict[str, object]:
        body: dict[str, object] = {"id": "demo", "status": "live"} | {
            k: v
            for k, v in self.event.items()
            if k not in ("contact_user_id", "presence_delete_at", "series_id")
        }
        if self.full:
            body |= {
                "revision": self.revision,
                "admin_access": self.admin_access,
                "screen_access": self.screen_access,
                "contact_user_id": self.event["contact_user_id"],
                "presence_delete_at": self.event["presence_delete_at"],
                "series_id": self.event["series_id"],
            }
        return body

    def reads(self, path: str) -> object:
        return {
            "/api/tenants/current": self.body(),
            "/api/tenants/current/venue-info": self.venue_info,
            "/api/tenants/current/flags": {
                "flags_version": self.flags_version,
                "flags": self.flags,
            },
            "/api/tenants/current/hostnames": {
                "hostnames": [
                    {
                        "hostname": "admin.example.test",
                        "kind": "custom",
                        "status": "active",
                        "primary": True,
                    },
                    {
                        "hostname": "demo.platform.test",
                        "kind": "platform",
                        "status": "active",
                        "primary": False,
                    },
                ]
            },
            "/api/tenants/current/venue": {
                "id": "v-demo",
                "name": "Demo Hall",
                "addresses": ["192.0.2.0/24"],
            },
            "/api/tenants/current/storage": {
                "quota_bytes": 2147483648,
                "used_bytes": 1288490189,
                "modules": {},
            },
        }.get(path)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        path = request.url.path
        if path in self.down:
            raise httpx.ConnectError("tenants is down", request=request)
        if request.method == "GET" and path in self.status_of:
            return httpx.Response(
                self.status_of[path], json={"error": {"code": "refused", "message": "x"}}
            )
        if request.method == "GET":
            found = self.reads(path)
            if found is None:
                return httpx.Response(404, json={"error": {"code": "not_found", "message": "x"}})
            return httpx.Response(200, json=found)
        if self.refuse is not None:
            status, code = self.refuse
            self.refuse = None
            return httpx.Response(status, json={"error": {"code": code, "message": "raw detail"}})
        conflict = httpx.Response(
            409, json={"error": {"code": "version_conflict", "message": "changed meanwhile"}}
        )
        if path.endswith("/floor-plan"):
            self.plan = (request.headers["content-type"], request.content)
            self.venue_info["floor_plan"] = {"content_type": "image/png", "updated_at": "x"}
            return httpx.Response(200, json=self.venue_info)
        body = json.loads(request.content)
        if path.endswith("/venue-info"):
            if body["revision"] != self.venue_info["revision"]:
                return conflict
            self.venue_info |= {k: v for k, v in body.items() if k != "revision"}
            self.venue_info["revision"] = body["revision"] + 1
            return httpx.Response(200, json=self.venue_info)
        if path.endswith("/flags"):
            if body["flags_version"] != self.flags_version:
                return conflict
            self.flags |= body["flags"]
            self.flags_version += 1
            return httpx.Response(
                200, json={"flags_version": self.flags_version, "flags": self.flags}
            )
        if body["revision"] != self.revision:
            return conflict
        self.admin_access = body.get("admin_access", self.admin_access)
        self.screen_access = body.get("screen_access", self.screen_access)
        self.event |= {k: v for k, v in body.items() if k in self.event}
        self.revision += 1
        return httpx.Response(200, json=self.body())


@dataclass
class FakeScreen:
    """Screen's `GET /internal/screen/zones` for the admin home; `down` never answers."""

    zones: list[dict[str, str]] = field(
        default_factory=lambda: [
            {"key": "main", "name": "Main hall"},
            {"key": "stage", "name": "Stage"},
        ]
    )
    down: bool = False
    seen: list[httpx.Request] = field(default_factory=list)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        if self.down:
            raise httpx.ConnectTimeout("screen is down", request=request)
        return httpx.Response(200, json={"zones": self.zones})
