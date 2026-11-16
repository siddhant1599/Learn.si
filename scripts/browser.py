"""Shared settings for headless browser checks.

E2E_BASE_URL selects the frontend (default: the local production server on 3001).
Browsers are Playwright-managed Chromium (`uv run playwright install chromium`);
set CHROME_PATH only to run against a specific local Chrome build.
"""

import os

BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:3001").rstrip("/")
ARTIFACTS = os.environ.get("E2E_ARTIFACTS", ".local")


def launch_options() -> dict:
    path = os.environ.get("CHROME_PATH")
    return {"headless": True, **({"executable_path": path} if path else {})}


def launch(playwright):
    """Sync API launch."""
    return playwright.chromium.launch(**launch_options())


async def launch_async(playwright):
    return await playwright.chromium.launch(**launch_options())
