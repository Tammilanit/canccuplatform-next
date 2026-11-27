"""The REST side of one client (contracts/bot.md, One event's trouble stays its own).

Discord counts rate limits per token, so every event on a client gets its own queue, served in
turn: a burst of one event waits in its own queue. Each bucket (route and major parameter) has one
request in flight, so its count from Discord's headers is always the one the next request reads.
A token that stops working stops the client, and a run of invalid answers (401, 403, 429) pauses
it: Discord blocks the address of a bot that keeps sending them, which would stop every client on
the VM.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

log = logging.getLogger("canccu_bot.rest")

MAJOR = ("channels", "guilds", "webhooks")
USER_AGENT = "DiscordBot (canccu, 1)"


class RestError(Exception):
    def __init__(
        self, status: int, code: str, message: str = "", discord_code: int | None = None
    ) -> None:
        super().__init__(f"{status} {code} {message}".strip())
        self.status = status
        self.code = code
        self.discord_code = discord_code


@dataclass
class _Retry(Exception):
    after: float


@dataclass
class _Job:
    tenant: str | None
    method: str
    path: str
    json: Any
    future: asyncio.Future[Any]
    tries: int = 0


@dataclass
class _Bucket:
    remaining: int
    reset_at: float
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


def route_key(method: str, path: str) -> str:
    """The route with every id but the major parameter replaced: Discord's rate-limit route."""
    parts = path.split("/")
    for i in range(1, len(parts)):
        prev = parts[i - 1]
        if prev == "interactions" and parts[i].isdigit():
            parts[i] = "{id}"
            if i + 1 < len(parts):
                parts[i + 1] = "{token}"
        elif parts[i].isdigit() and prev not in MAJOR:
            parts[i] = "{id}"
    return f"{method} {'/'.join(parts)}"


class RestClient:
    def __init__(
        self,
        token: str,
        *,
        http: httpx.AsyncClient,
        api_url: str,
        queue_cap: int = 500,
        workers: int = 4,
        breaker_threshold: int = 100,
        breaker_window_s: float = 600.0,
        max_tries: int = 3,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._token = token
        self._http = http
        self._api_url = api_url.rstrip("/")
        self._cap = queue_cap
        self._worker_count = workers
        self._threshold = breaker_threshold
        self._window = breaker_window_s
        self._max_tries = max_tries
        self._clock = clock
        self.on_change: Callable[[], None] = lambda: None
        self.rate_limited = False
        self._queues: dict[str | None, deque[_Job]] = {}
        self._turns: deque[str | None] = deque()
        self._busy: set[str | None] = set()
        self._wake = asyncio.Event()
        self._workers: list[asyncio.Task[None]] = []
        self._buckets: dict[str, _Bucket] = {}
        self._hashes: dict[str, str] = {}
        self._global_until = 0.0
        self._invalid: deque[float] = deque()
        self._paused_until = 0.0
        self._token_invalid = False
        self._resume: asyncio.TimerHandle | None = None

    @property
    def stopped(self) -> str | None:
        """Why nothing is sent now: `token_invalid` (until new credentials) or `invalid_requests`
        (paused for the breaker's window)."""
        if self._token_invalid:
            return "token_invalid"
        if self._clock() < self._paused_until:
            return "invalid_requests"
        return None

    async def request(
        self, method: str, path: str, *, tenant: str | None = None, json: Any = None
    ) -> Any:
        """Send one request in `tenant`'s queue (None: the platform's own calls)."""
        self._refuse_if_stopped()
        queue = self._queues.get(tenant)
        if queue is None:
            queue = self._queues[tenant] = deque()
            self._turns.append(tenant)
        if len(queue) >= self._cap:
            raise RestError(429, "rate_limited", "this event's queue is full")
        job = _Job(tenant, method, path, json, asyncio.get_running_loop().create_future())
        queue.append(job)
        self._start_workers()
        self._wake.set()
        return await job.future

    def _refuse_if_stopped(self) -> None:
        reason = self.stopped
        if reason is not None:
            raise RestError(401 if reason == "token_invalid" else 503, reason, "the client stopped")

    def _start_workers(self) -> None:
        if not self._workers:
            self._workers = [asyncio.create_task(self._work()) for _ in range(self._worker_count)]

    def _next(self) -> _Job | None:
        """The next event's next job. An event has one job in flight at a time, so its burst
        waiting on a bucket holds one worker, never all of them."""
        for _ in range(len(self._turns)):
            tenant = self._turns.popleft()
            if tenant in self._busy:
                self._turns.append(tenant)
                continue
            queue = self._queues[tenant]
            job = queue.popleft()
            if queue:
                self._turns.append(tenant)
            else:
                del self._queues[tenant]
            self._busy.add(tenant)
            return job
        return None

    def _requeue(self, job: _Job) -> None:
        """Back to the head of its own queue, after a 429's wait."""
        queue = self._queues.get(job.tenant)
        if queue is None:
            queue = self._queues[job.tenant] = deque()
            self._turns.append(job.tenant)
        queue.appendleft(job)
        self._wake.set()

    async def _work(self) -> None:
        while True:
            job = self._next()
            if job is None:
                self._wake.clear()
                await self._wake.wait()
                continue
            try:
                await self._run(job)
            finally:
                self._busy.discard(job.tenant)
                self._wake.set()

    async def _run(self, job: _Job) -> None:
        if job.future.done():  # the caller gave up
            return
        try:
            result = await self._send(job)
        except _Retry as retry:
            await asyncio.sleep(retry.after)
            self._requeue(job)
        except RestError as exc:
            job.future.set_exception(exc)
        except httpx.HTTPError as exc:
            job.future.set_exception(RestError(0, "discord_unavailable", str(exc)))
        else:
            job.future.set_result(result)

    async def _send(self, job: _Job) -> Any:
        self._refuse_if_stopped()
        await self._wait_global()
        route = route_key(job.method, job.path)
        bucket = self._bucket(route, job.path)
        async with bucket.lock:
            now = self._clock()
            if bucket.remaining <= 0 and now < bucket.reset_at:
                await asyncio.sleep(bucket.reset_at - now)
            self._refuse_if_stopped()
            response = await self._http.request(
                job.method,
                self._api_url + job.path,
                json=job.json,
                headers={"Authorization": f"Bot {self._token}", "User-Agent": USER_AGENT},
            )
            self._learn(route, job.path, bucket, response.headers)
        return self._answer(job, response)

    def _bucket(self, route: str, path: str) -> _Bucket:
        """Discord names a bucket by a hash per route, shared by the routes of one limit, and
        counts it per major parameter; until a route's hash is known, the route is the bucket."""
        key = self._key(route, path)
        found = self._buckets.get(key)
        if found is None:
            found = self._buckets[key] = _Bucket(remaining=1, reset_at=0.0)
        return found

    def _key(self, route: str, path: str) -> str:
        bucket_hash = self._hashes.get(route)
        if bucket_hash is None:
            return route
        parts = path.split("/")
        major = [parts[i + 1] for i, p in enumerate(parts[:-1]) if p in MAJOR]
        return f"{bucket_hash}:{'/'.join(major)}"

    def _learn(self, route: str, path: str, bucket: _Bucket, headers: httpx.Headers) -> None:
        if "x-ratelimit-remaining" not in headers:
            return
        bucket.remaining = int(headers["x-ratelimit-remaining"])
        bucket.reset_at = self._clock() + float(headers.get("x-ratelimit-reset-after", "0"))
        bucket_hash = headers.get("x-ratelimit-bucket")
        if bucket_hash and self._hashes.get(route) != bucket_hash:
            self._hashes[route] = bucket_hash
            self._buckets.setdefault(self._key(route, path), bucket)

    async def _wait_global(self) -> None:
        wait = self._global_until - self._clock()
        if wait > 0:
            await asyncio.sleep(wait)
        if self.rate_limited and self._clock() >= self._global_until:
            self.rate_limited = False
            self.on_change()

    def _answer(self, job: _Job, response: httpx.Response) -> Any:
        status = response.status_code
        if status < 300:
            return response.json() if response.content else None
        body = _json(response)
        discord_code = body.get("code") if isinstance(body.get("code"), int) else None
        message = str(body.get("message", ""))
        if status == 401:
            self._stop()
            raise RestError(401, "token_invalid", message, discord_code)
        if status == 429:
            return self._too_many(job, response, body)
        if status == 403:
            self._count_invalid()
        if status >= 500:
            raise RestError(status, "discord_unavailable", message, discord_code)
        raise RestError(status, "discord_error", message, discord_code)

    def _too_many(self, job: _Job, response: httpx.Response, body: dict[str, Any]) -> Any:
        # A 429 on a limit shared with other bots (scope shared) is no fault of ours.
        if response.headers.get("x-ratelimit-scope") != "shared":
            self._count_invalid()
        after = float(body.get("retry_after") or response.headers.get("retry-after") or 1)
        if body.get("global") or response.headers.get("x-ratelimit-global") == "true":
            self._global_until = self._clock() + after
            if not self.rate_limited:
                self.rate_limited = True
                self.on_change()
        job.tries += 1
        if job.tries >= self._max_tries:
            raise RestError(429, "rate_limited", "Discord kept refusing")
        raise _Retry(after)

    def _count_invalid(self) -> None:
        now = self._clock()
        self._invalid.append(now)
        while self._invalid and self._invalid[0] <= now - self._window:
            self._invalid.popleft()
        if len(self._invalid) >= self._threshold:
            log.warning("too many invalid requests; pausing the client")
            self._invalid.clear()
            self._paused_until = now + self._window
            self._fail_queued("invalid_requests")
            self._resume = asyncio.get_running_loop().call_later(self._window, self.on_change)
            self.on_change()

    def _stop(self) -> None:
        if self._token_invalid:
            return
        self._token_invalid = True
        self._fail_queued("token_invalid")
        self.on_change()

    def _fail_queued(self, code: str) -> None:
        for queue in self._queues.values():
            for job in queue:
                if not job.future.done():
                    job.future.set_exception(RestError(503, code, "the client stopped"))
        self._queues.clear()
        self._turns.clear()

    async def close(self) -> None:
        if self._resume is not None:
            self._resume.cancel()
        for task in self._workers:
            task.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers = []
        self._fail_queued("client_closed")


def _json(response: httpx.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}
