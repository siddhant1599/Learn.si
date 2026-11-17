"""Shared settings for headless browser checks.

E2E_BASE_URL selects the frontend (default: the local production server on 3001).
Browsers are Playwright-managed Chromium (`uv run playwright install chromium`);
set CHROME_PATH only to run against a specific local Chrome build.
"""

import os

BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:3001").rstrip("/")
# Assertion wait: CI runners are several times slower than a laptop (client navigation,
# hydration, scripted demos), so assertions there get more time. Failures still fail.
EXPECT_TIMEOUT_MS = int(os.environ.get("E2E_EXPECT_TIMEOUT_MS", "15000" if os.environ.get("CI") else "5000"))

try:  # Applies to every check that imports this module.
    from playwright.sync_api import expect as _sync_expect

    _sync_expect.set_options(timeout=EXPECT_TIMEOUT_MS)
except ImportError:  # Playwright is optional for non-browser tooling.
    pass
ARTIFACTS = os.environ.get("E2E_ARTIFACTS", ".local")


def launch_options() -> dict:
    path = os.environ.get("CHROME_PATH")
    return {"headless": True, **({"executable_path": path} if path else {})}


def launch(playwright):
    """Sync API launch."""
    return playwright.chromium.launch(**launch_options())


async def launch_async(playwright):
    return await playwright.chromium.launch(**launch_options())
