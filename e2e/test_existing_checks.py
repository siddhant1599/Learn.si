"""The established scripts/check_web_*.py regressions, run as part of the suite.

They keep their own browsers and fixtures (each is self-contained and still runs on
its own); here they receive the suite's base URL and report as individual tests.
check_web_live is excluded: it uploads real data and spends provider credits, so it
stays opt-in and separately reported.
"""

import os
import subprocess
import sys

import pytest

from e2e.conftest import BASE

CHECKS = [
    "check_web_landing",   # Hero, scroll stage, demo lesson + quiz, product images, privacy
    "check_web_docs",      # Docs routes, anchors, history, search, themes, mobile, 404
    "check_web_modes",     # Chooser, remembered mode, switching, deep links, rail, mobile
    "check_web_frontend",  # Landing examples, upload chooser, SSE answer, follow-up, themes
    "check_web_streaming", # Incremental tokens, out-of-order activity, recovery, interruption
    "check_web_research",  # Document vs web sections, transient web data after reload
    "check_web_deletions", # Chat/source deletion, pending cleanup, stale caches, mobile
    "check_web_persistence",  # Two-tab chats, malformed cache recovery
    "check_web_master",    # Full Master learning loop, 1440/390 px, light/dark
]


# Each existing check is a whole multi-scenario script run as a subprocess with its own
# 600 s limit; on CI (software-rendered WebGL) check_web_landing alone takes ~5 minutes,
# so these get that limit instead of the suite's 240 s per-test default.
@pytest.mark.timeout(600)
@pytest.mark.parametrize("check", CHECKS)
def test_existing_browser_check(check, tmp_path):
    env = {**os.environ, "E2E_BASE_URL": BASE, "E2E_ARTIFACTS": str(tmp_path)}
    result = subprocess.run(
        [sys.executable, "-m", f"scripts.{check}"], env=env, capture_output=True, text=True, timeout=600,
    )
    output = _failure_excerpt(result.stdout + result.stderr)
    assert result.returncode == 0, f"{check} failed:\n{output}"


def _failure_excerpt(text: str, limit: int = 4000) -> str:
    """Keep the error, not just the tail: Playwright's accessibility-tree dumps
    ("- heading ...", "- paragraph: ...") can be longer than the limit and push the
    traceback and the failing assertion out of the report."""
    lines = [line for line in text.splitlines() if not line.lstrip().startswith(("- ", "-\t"))]
    excerpt = "\n".join(lines)
    return excerpt[-limit:]
