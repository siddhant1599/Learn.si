"""The suite's safety nets work: unknown API requests and other hosts are caught,
console errors fail unless allowed by the test that provokes them, held responses
release in order, and retries are sequenced."""

from e2e.conftest import wait_until
from e2e.router import error, ok


def test_unexpected_api_and_external_requests_are_caught(page, api, console):
    console.allow(r"status of 599|Failed to fetch|ERR_FAILED")
    page.goto("/docs")
    page.evaluate("fetch('/api/rag/not-registered').catch(() => {})")
    page.evaluate("fetch('https://example.com/telemetry').catch(() => {})")
    wait_until(page, lambda: api.unexpected and api.external, message="guards to record requests")
    assert api.unexpected == ["GET /api/rag/not-registered"]
    assert api.external == ["https://example.com/telemetry"]
    # Clear what this test provoked on purpose, so teardown checks the rest.
    api.unexpected.clear()
    api.external.clear()


def test_console_errors_fail_unless_allowed_by_the_test(page, api, console):
    page.goto("/docs")
    page.evaluate("console.error('provoked failure A')")
    page.evaluate("console.error('provoked failure B')")
    wait_until(page, lambda: len(console.errors) == 2, message="console errors")
    console.allow(r"failure A")
    assert console.unexpected() == ["console: provoked failure B"]
    console.allow(r"failure B")
    assert console.unexpected() == []


def test_held_responses_and_retry_sequences(page, api, console):
    console.allow(r"status of 503")
    api.on("GET", "progress", error("first", 503), ok({"n": 2}), ok({"n": 3}))
    api.on("GET", "courses", hold=True)
    page.goto("/docs")
    statuses = page.evaluate("""async () => {
      const out = [];
      for (let i = 0; i < 4; i++) out.push((await fetch('/api/rag/progress')).status);
      return out;
    }""")
    assert statuses == [503, 200, 200, 200]  # The last reply repeats.
    # Return nothing: evaluating the promise itself would wait for the held reply.
    page.evaluate("() => { window.__held = fetch('/api/rag/courses').then(r => r.json()); }")
    wait_until(page, lambda: api.waiting("courses") == 1, message="held request")
    api.release("courses", ok(["released"]))
    assert page.evaluate("window.__held") == ["released"]
