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

# Leaving a page with the WebGL starfield (landing hero, mode chooser): browsers without GPU
# acceleration (headless test browsers, CI runners) draw it in software, which delays the
# next client navigation by seconds (measured 2-3 s locally; 0.05 s with a GPU). Navigation
# waits after those pages use this longer limit; a real failure still fails.
LEAVE_STARFIELD_TIMEOUT_MS = 30_000

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


class SavedChats:
    """A fake of the server's Ask chat storage for checks that mock /api/rag/query.

    Chats live on the server, so a check that answers questions itself must also save
    them here; the app then lists and reloads them like it does from the real backend.
    """

    def __init__(self):
        self.chats: dict[str, dict] = {}

    def add(self, chat_id, title, document_ids, turns):
        self.chats[chat_id] = {"title": title, "document_ids": list(document_ids), "turns": []}
        for question, answer, citations in turns:
            self.record(chat_id, question, answer, citations)

    def record(self, chat_id, question, answer, citations=(), steps=(), warnings=()):
        chat = self.chats.setdefault(chat_id, {"title": question, "document_ids": [], "turns": []})
        turns = chat["turns"]
        turns.append({"id": len(turns) + 1, "role": "user", "content": question,
                      "citations": [], "steps": [], "warnings": []})
        turns.append({"id": len(turns) + 1, "role": "assistant", "content": answer,
                      "citations": list(citations), "steps": list(steps), "warnings": list(warnings)})

    def remove(self, chat_id):
        self.chats.pop(chat_id, None)

    def install(self, target):
        """Serve the list and messages on a Playwright page or context."""
        import re

        def listing(route):
            route.fulfill(json=[
                {"id": cid, "title": chat["title"], "document_ids": chat["document_ids"],
                 "updated_at": "2026-11-17T10:00:00Z", "message_count": len(chat["turns"])}
                for cid, chat in self.chats.items()])

        def messages(route):
            chat_id = route.request.url.split("/conversations/", 1)[1].split("/", 1)[0]
            chat = self.chats.get(chat_id)
            if chat is None:
                return route.fulfill(status=404, json={"detail": "Conversation does not exist"})
            route.fulfill(json=[] if "before=" in route.request.url else chat["turns"])

        target.route(re.compile(r".*/api/rag/conversations(\?.*)?$"), listing)
        target.route(re.compile(r".*/api/rag/conversations/[^/]+/messages(\?.*)?$"), messages)
