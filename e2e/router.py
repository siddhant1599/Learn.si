"""Deterministic /api/rag fixtures for browser tests.

Every request to /api/rag must match a registered responder; anything else is
recorded as unexpected and fails the test at teardown. Requests to any host other
than the app are aborted and fail the test too, so default runs can never reach a
live provider or modify real data. Responders cover success, empty, delayed (held),
malformed, failed and fail-then-succeed (retry) responses; request bodies are kept
for contract assertions.
"""

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable
from urllib.parse import urlparse

from fastapi.encoders import jsonable_encoder


@dataclass
class Reply:
    status: int = 200
    body: str = ""
    content_type: str = "application/json"
    abort: bool = False


def ok(payload: Any = None, status: int = 200) -> Reply:
    return Reply(status, json.dumps(jsonable_encoder(payload)))


def error(detail: str, status: int) -> Reply:
    return Reply(status, json.dumps({"detail": detail}))


def sse(*frames: tuple[str, Any]) -> Reply:
    body = "".join(f"event: {name}\ndata: {json.dumps(jsonable_encoder(data))}\n\n" for name, data in frames)
    return Reply(200, body, "text/event-stream")


def malformed(body: str = "{not json", status: int = 200, content_type: str = "application/json") -> Reply:
    return Reply(status, body, content_type)


def network_failure() -> Reply:
    return Reply(abort=True)


@dataclass
class Request:
    method: str
    path: str
    query: str
    body: Any


@dataclass
class Handler:
    method: str
    pattern: re.Pattern
    replies: list
    calls: int = 0
    hold: bool = False


@dataclass
class FixtureRouter:
    base_url: str
    handlers: list = field(default_factory=list)
    requests: list = field(default_factory=list)
    unexpected: list = field(default_factory=list)
    external: list = field(default_factory=list)
    held: dict = field(default_factory=dict)
    served: list = field(default_factory=list)  # (method, path, body) of every fixture reply
    fallback: Callable[[str, str, Any], Reply | None] | None = None

    def install(self, context):
        context.route("**/*", self._route)

    def on(self, method: str, path: str, *replies, hold: bool = False) -> Handler:
        """Register replies for METHOD + regex path (relative to /api/rag/). Replies are
        consumed in order and the last one repeats; callables receive the Request.
        Newer registrations win, so a test can override a world default."""
        handler = Handler(method.upper(), re.compile(path + r"$"), list(replies), hold=hold)
        self.handlers.insert(0, handler)
        return handler

    def calls(self, method: str, path: str) -> list[Request]:
        pattern = re.compile(path + r"$")
        return [r for r in self.requests if r.method == method.upper() and pattern.fullmatch(r.path)]

    def release(self, path: str, reply: Reply | None = None):
        """Answer the oldest held request for `path` (a delayed response)."""
        route, handler, request = self.held[path].pop(0)
        self._serve(route, request, reply or self._next(handler, request))

    def waiting(self, path: str) -> int:
        return len(self.held.get(path, []))

    # Internals -------------------------------------------------------------

    def _route(self, route):
        url = urlparse(route.request.url)
        base = urlparse(self.base_url)
        if url.scheme in ("data", "blob"):
            return route.continue_()
        if (url.scheme, url.netloc) != (base.scheme, base.netloc):
            self.external.append(route.request.url)
            return route.abort()
        if not url.path.startswith("/api/rag/"):
            return route.continue_()
        path = url.path.removeprefix("/api/rag/")
        method = route.request.method
        raw = route.request.post_data if method != "GET" else None
        try:
            body = json.loads(raw) if raw else None
        except (ValueError, UnicodeDecodeError):
            body = raw
        request = Request(method, path, url.query, body)
        self.requests.append(request)
        for handler in self.handlers:
            if handler.method == method and handler.pattern.fullmatch(path):
                if handler.hold:
                    self.held.setdefault(path, []).append((route, handler, request))
                    return None
                return self._serve(route, request, self._next(handler, request))
        if self.fallback:
            reply = self.fallback(method, path, body, url.query)
            if reply is not None:
                return self._serve(route, request, reply)
        self.unexpected.append(f"{method} /api/rag/{path}")
        return self._fulfill(route, error("Unexpected request in fixture", 599))

    def _next(self, handler: Handler, request: Request) -> Reply:
        reply = handler.replies[min(handler.calls, len(handler.replies) - 1)]
        handler.calls += 1
        return reply(request) if callable(reply) else reply

    def bodies(self, method: str, path: str) -> list[str]:
        """Bodies served for METHOD + regex path: exactly what the browser received."""
        pattern = re.compile(path + r"$")
        return [body for m, p, body in self.served if m == method.upper() and pattern.fullmatch(p)]

    def _serve(self, route, request: Request, reply: Reply):
        self.served.append((request.method, request.path, reply.body))
        return self._fulfill(route, reply)

    @staticmethod
    def _fulfill(route, reply: Reply):
        if reply.abort:
            return route.abort("failed")
        return route.fulfill(status=reply.status, body=reply.body, headers={"Content-Type": reply.content_type})
