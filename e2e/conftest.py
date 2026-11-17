"""Browser suite fixtures.

Each test gets a fresh browser context (isolated cookies, localStorage and
sessionStorage), a fresh FixtureRouter and a fresh fixture backend. Teardown fails
the test on unexpected API requests, requests to other hosts, uncaught page errors
and console errors, except patterns the test itself allowed for errors it provokes.
"""

import os
import re

import pytest

from e2e.router import FixtureRouter, Reply, ok
from scripts.check_web_master import FixtureBackend

BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:3001").rstrip("/")
DOC = "11111111-1111-4111-8111-111111111111"


@pytest.fixture(scope="session")
def base_url():
    return BASE


@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args):
    path = os.environ.get("CHROME_PATH")
    return {**browser_type_launch_args, **({"executable_path": path} if path else {})}


@pytest.fixture
def browser_context_args(browser_context_args):
    return {**browser_context_args, "viewport": {"width": 1440, "height": 900}, "base_url": BASE}


class Console:
    """Collects page errors and console errors; tests allow only what they provoke."""

    def __init__(self):
        self.errors: list[str] = []
        self.allowed: list[re.Pattern] = []

    def allow(self, pattern: str):
        self.allowed.append(re.compile(pattern))

    def unexpected(self) -> list[str]:
        return [e for e in self.errors if not any(p.search(e) for p in self.allowed)]


@pytest.fixture
def console(page):
    collector = Console()
    page.on("pageerror", lambda error: collector.errors.append(f"pageerror: {error}"))
    page.on("console", lambda message: collector.errors.append(f"console: {message.text}")
            if message.type == "error" else None)
    yield collector
    assert not collector.unexpected(), collector.unexpected()


@pytest.fixture
def api(context, console):
    router = FixtureRouter(BASE)
    router.install(context)
    # Every workspace page reads these; tests override them where needed.
    router.on("GET", "deletions", ok([]))
    router.on("GET", "health", ok({"status": "ok", "service": "fixture", "web_available": True}))
    router.on("GET", "documents", ok([]))
    # Ask chats are listed from the server; tests that need saved chats override this.
    router.on("GET", "conversations", ok([]))
    yield router
    assert not router.unexpected, f"Unexpected API requests: {router.unexpected}"
    assert not router.external, f"Requests to other hosts: {router.external}"


@pytest.fixture
def ask_world(api):
    """One indexed source and no chats."""
    api.on("GET", "documents", ok([{"id": DOC, "title": "Synthetic handbook", "edition": "test"}]))
    return api


@pytest.fixture
def master(api):
    """Stateful Master backend built from tests/fixtures/master and the app's validators."""
    backend = FixtureBackend()

    def dispatch(method, path, body, query):
        result = backend.dispatch(method, path, body or {}, query)
        if result is None:
            return None
        status, payload, kind = result
        return Reply(200, payload, "text/event-stream") if kind == "sse" else ok(payload, status)

    api.fallback = dispatch
    # Master owns these paths; drop the generic defaults so its state is used.
    api.handlers = [h for h in api.handlers if h.pattern.pattern not in ("documents$",)]
    return backend


def set_theme(page, theme: str):
    page.evaluate(f"document.documentElement.classList.toggle('dark', {str(theme == 'dark').lower()})")


def no_overflow(page, label: str = ""):
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"horizontal overflow {label}"


def storage_dump(page) -> str:
    return page.evaluate(
        "() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])")


def alerts(page):
    """App alerts, excluding Next.js's empty route announcer (also role=alert)."""
    return page.locator('[role="alert"]:not(#__next-route-announcer__)')


def wait_until(page, predicate, timeout_ms: int = 5000, message: str = "condition"):
    """Poll a Python-side condition (e.g. recorded requests) without fixed sleeps."""
    for _ in range(max(1, timeout_ms // 50)):
        if predicate():
            return
        page.wait_for_timeout(50)
    assert predicate(), f"timed out waiting for {message}"


def release_when_held(page, api, path: str, reply=None):
    """Answer a delayed (held) request once the browser has actually sent it."""
    wait_until(page, lambda: api.waiting(path) > 0, message=f"held request {path}")
    api.release(path, reply)


# Results ---------------------------------------------------------------------
# One JSON record per test: final outcome, every attempt (so a pass after a rerun is
# reported as flaky, never hidden), duration and skip reasons.

_RESULTS: dict[str, dict] = {}


def pytest_runtest_logreport(report):
    entry = _RESULTS.setdefault(report.nodeid, {"id": report.nodeid, "attempts": [], "duration": 0.0})
    if report.when == "call" or report.outcome in ("failed", "skipped") or report.outcome == "rerun":
        if report.when != "call" and report.outcome == "passed":
            return
        outcome = report.outcome
        entry["attempts"].append({"phase": report.when, "outcome": outcome})
        entry["duration"] += report.duration
        if outcome == "skipped":
            reason = report.longrepr[2] if isinstance(report.longrepr, tuple) else str(report.longrepr)
            entry["skip_reason"] = reason
        if outcome in ("failed", "rerun") and report.longrepr is not None:
            entry["error"] = str(report.longreprtext).splitlines()[-1][:500] if report.longreprtext else ""


def pytest_sessionfinish(session):
    path = os.environ.get("E2E_RESULTS")
    if not path:
        return
    import json
    from pathlib import Path

    records = []
    for entry in _RESULTS.values():
        outcomes = [a["outcome"] for a in entry["attempts"]]
        final = "skipped" if "skipped" in outcomes else (outcomes[-1] if outcomes else "unknown")
        if final == "rerun":
            final = "failed"
        records.append({**entry, "outcome": final,
                        "flaky": final == "passed" and "rerun" in outcomes})
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(records, indent=2))
