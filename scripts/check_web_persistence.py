"""Chats are stored on the server: a chat written in one tab is listed and readable in
another browser (a different device), steps included, and a broken leftover browser
cache from older builds never breaks the workspace. Mocked API; nothing real is touched."""

import asyncio
import json
import re
import uuid

from playwright.async_api import async_playwright, expect

from scripts.browser import BASE, launch_async

DOC = "11111111-1111-4111-8111-111111111111"


def frame(event, data):
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


class FakeServer:
    """Just enough of the backend's chat storage: what one browser saves, any browser lists."""

    def __init__(self):
        self.chats = {}

    async def route(self, route):
        request, url = route.request, route.request.url
        path = url.split("/api/rag/", 1)[1].split("?", 1)[0]
        if path == "health":
            return await route.fulfill(json={"web_available": False})
        if path == "documents":
            return await route.fulfill(json=[{"id": DOC, "title": "Fixture", "edition": "v1"}])
        if path == "deletions":
            return await route.fulfill(json=[])
        if path == "conversations":
            return await route.fulfill(json=[
                {"id": cid, "title": chat["turns"][0]["content"], "document_ids": [DOC],
                 "updated_at": "2026-11-17T10:00:00Z", "message_count": len(chat["turns"])}
                for cid, chat in self.chats.items()])
        if match := re.fullmatch(r"conversations/([^/]+)/messages", path):
            chat = self.chats.get(match.group(1))
            if not chat:
                return await route.fulfill(status=404, json={"detail": "Conversation does not exist"})
            return await route.fulfill(json=[] if "before=" in url else chat["turns"])
        if path == "query":
            body = request.post_data_json
            cid = body.get("thread_id") or body.get("new_thread_id") or str(uuid.uuid4())
            answer = f"Answer to {body['user_query']}"
            step = {"type": "progress", "version": 1, "step": "triage", "id": "triage",
                    "status": "completed", "attempt": 0, "sequence": 1, "outcome": "direct_retrieval"}
            turns = self.chats.setdefault(cid, {"turns": []})["turns"]
            turns += [{"id": len(turns) + 1, "role": "user", "content": body["user_query"], "citations": [], "steps": []},
                      {"id": len(turns) + 2, "role": "assistant", "content": answer, "citations": [],
                       "steps": [step], "warnings": []}]
            return await route.fulfill(content_type="text/event-stream", body=(
                frame("session", {"thread_id": cid}) + frame("progress", step)
                + frame("result", {"answer": answer, "citations": [], "warnings": []})))
        return await route.fulfill(status=404, json={"detail": "not mocked"})


async def main():
    server = FakeServer()
    async with async_playwright() as p:
        browser = await launch_async(p)
        errors = []

        async def open_context():
            context = await browser.new_context()
            await context.route("**/api/rag/**", server.route)
            return context

        laptop = await open_context()
        a, b = await laptop.new_page(), await laptop.new_page()
        for page in (a, b):
            page.on("pageerror", lambda e: errors.append(str(e)))
        await asyncio.gather(*(page.goto(BASE + "/workspace/chats/new") for page in (a, b)))

        async def send(page, text):
            await page.get_by_role("checkbox", name="Fixture v1").check()
            await page.get_by_role("textbox", name="Message", exact=True).fill(text)
            await page.get_by_role("button", name="Send", exact=True).click()
            await expect(page.get_by_text(f"Answer to {text}", exact=True)).to_be_visible()

        await asyncio.gather(send(a, "Tab A fixture"), send(b, "Tab B fixture"))
        assert len(server.chats) == 2, server.chats
        assert all(re.fullmatch(r"[0-9a-f-]{36}", cid) for cid in server.chats)  # Browser-chosen UUIDs.
        stored = await a.evaluate(
            "Object.keys(localStorage).filter(k => k.startsWith('document-lab.chat.v2.')).length")
        assert stored == 0, "chats must not be kept in browser storage"
        print("PASS: two tabs save their chats on the server under browser-chosen ids, nothing in browser storage")

        # Another device: a fresh browser with empty storage lists both chats and opens one.
        phone = await open_context()
        other = await phone.new_page()
        other.on("pageerror", lambda e: errors.append(str(e)))
        await other.goto(BASE + "/workspace/chats", wait_until="networkidle")
        for title in ("Tab A fixture", "Tab B fixture"):
            await expect(other.get_by_role("link", name=title).first).to_be_visible()
        cid = next(c for c, chat in server.chats.items() if chat["turns"][0]["content"] == "Tab A fixture")
        await other.goto(f"{BASE}/workspace/chats/{cid}", wait_until="networkidle")
        await expect(other.get_by_text("Answer to Tab A fixture", exact=True)).to_be_visible()
        await expect(other.get_by_text("Request routed", exact=True)).to_be_visible()  # Steps were kept.
        print("PASS: another browser lists both chats and opens one with its answer and steps")

        # A broken leftover cache from older builds: the workspace still works, the junk is removed.
        # (A browser that last ran an older build: the one-time move has not happened yet.)
        await a.evaluate(
            "localStorage.removeItem('learn-si.chats-imported');"
            "localStorage.setItem('document-lab.threads', '{}');"
            "localStorage.setItem('document-lab.chat.v2.broken', '{bad');"
            "localStorage.setItem('document-lab.settings', 'null')")
        await a.reload(wait_until="networkidle")
        await expect(a.get_by_role("textbox", name="Message", exact=True)).to_be_visible()
        await expect(a.get_by_role("link", name="Tab B fixture").first).to_be_visible()
        leftovers = await a.evaluate(
            "Object.keys(localStorage).filter(k => k.startsWith('document-lab.chat.v2.') || k === 'document-lab.threads')")
        assert leftovers == [], leftovers
        print("PASS: a broken old browser cache leaves the workspace usable and is cleaned up")
        assert not errors, errors
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
