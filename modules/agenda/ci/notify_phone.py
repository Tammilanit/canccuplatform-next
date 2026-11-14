"""The agenda's side of scripts/demo-stack-test's Notify test (#517): a demo phone subscribes, then
the agenda makes the three things the `schedule` topic turns into notifications. Prints the
subscription id and the titles Notify should give them, as JSON; the test then looks for their
delivery rows.

Runs in the agenda container (`python - < this`): from its loopback, an address of the demo venue,
the agenda takes an organiser's writes (contracts/tenants.md, admin access), and its image has
httpx and cryptography. Argument: the demo event's hostname. Environment: CANCCU_STACK_COOKIE.
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import sys
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def ok(response: httpx.Response, status: int) -> Any:
    if response.status_code != status:
        request = response.request
        sys.exit(f"{request.method} {request.url}: {response.status_code} {response.text}")
    return response.json() if response.content else None


def main() -> None:
    host = sys.argv[1]
    headers = {"host": host, "cookie": os.environ["CANCCU_STACK_COOKIE"]}
    point = (
        ec.generate_private_key(ec.SECP256R1())
        .public_key()
        .public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    )
    tag = secrets.token_hex(4)
    # `.invalid` never resolves (RFC 2606): the push fails, its delivery row stays, nothing leaves.
    push = {
        "endpoint": f"https://push.canccu-stack.invalid/{tag}",
        "keys": {"p256dh": b64(point), "auth": b64(secrets.token_bytes(16))},
    }
    with httpx.Client(timeout=20) as notify:
        sub = ok(
            notify.post(
                "http://notify:8080/api/notify/subscriptions", json={"push": push}, headers=headers
            ),
            201,
        )
    now = datetime.now(UTC)

    def at(delta: timedelta) -> str:
        return (now + delta).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    item = {"kind": "other", "visibility": "public", "notify_channels": ["push"]}
    with httpx.Client(base_url="http://127.0.0.1:8080", headers=headers, timeout=20) as agenda:
        # Its 10-minute reminder is due 20 seconds from now: the timer loop fires it within 25.
        reminded = ok(
            agenda.post(
                "/api/agenda/items",
                json={
                    **item,
                    "title": f"Stack reminder {tag}",
                    "starts_at": at(timedelta(minutes=10, seconds=20)),
                },
            ),
            201,
        )
        # An hour ahead, so its own reminders are not due while the test runs.
        moved = ok(
            agenda.post(
                "/api/agenda/items",
                json={**item, "title": f"Stack delay {tag}", "starts_at": at(timedelta(hours=1))},
            ),
            201,
        )
        ok(
            agenda.post(
                f"/api/agenda/items/{moved['id']}/delay",
                json={"revision": moved["revision"], "minutes": 5, "announce": True},
            ),
            200,
        )
        ok(
            agenda.post(
                f"/api/agenda/items/{moved['id']}/announce", json={"message": "Stack test"}
            ),
            204,
        )
    print(
        json.dumps(
            {
                "subscription_id": sub["id"],
                "reminder": f"{reminded['title']} at ",
                "delayed": f"{moved['title']} moved",
                "announced": moved["title"],
            }
        )
    )


if __name__ == "__main__":
    main()
