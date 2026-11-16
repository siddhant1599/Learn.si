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


@pytest.mark.parametrize("check", CHECKS)
def test_existing_browser_check(check, tmp_path):
    env = {**os.environ, "E2E_BASE_URL": BASE, "E2E_ARTIFACTS": str(tmp_path)}
    result = subprocess.run(
        [sys.executable, "-m", f"scripts.{check}"], env=env, capture_output=True, text=True, timeout=600,
    )
    output = (result.stdout + result.stderr)[-4000:]
    assert result.returncode == 0, f"{check} failed:\n{output}"
