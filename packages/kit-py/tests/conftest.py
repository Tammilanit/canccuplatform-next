from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest

from cp_kit import AdminClient
from cp_kit.testing import MemoryStreamStore


@dataclass
class FakeAdmin:
    """Answers admin API calls from a handler and records the requests."""

    handler: Callable[[httpx.Request], httpx.Response] | None = None
    requests: list[httpx.Request] = field(default_factory=list)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.handler is None:
            return httpx.Response(404, json={"error": {"code": "not_found", "message": "no"}})
        return self.handler(request)

    def client(self) -> AdminClient:
        http = httpx.AsyncClient(transport=httpx.MockTransport(self), base_url="http://admin")
        return AdminClient("http://admin", http)


@pytest.fixture
def store() -> MemoryStreamStore:
    return MemoryStreamStore()


@pytest.fixture
def admin() -> FakeAdmin:
    return FakeAdmin()


def json_response(status: int, body: Any) -> httpx.Response:
    return httpx.Response(status, json=body)
