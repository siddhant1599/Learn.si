"""Disposable two-tab cache regressions against the running frontend; mocked API."""

import asyncio
import json

from playwright.async_api import async_playwright, expect

BASE = "http://127.0.0.1:3001"


def frame(event, data):
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        )
        context = await browser.new_context()
        errors = []
        await context.route("**/api/rag/health", lambda r: r.fulfill(json={"web_available": False}))
        await context.route(
            "**/api/rag/documents",
            lambda r: r.fulfill(
                json=[
                    {
                        "id": "11111111-1111-4111-8111-111111111111",
                        "title": "Fixture",
                        "edition": "v1",
                    }
                ]
            ),
        )
        await context.route(
            "**/api/rag/query",
            lambda r: r.fulfill(
                content_type="text/event-stream",
                body=frame(
                    "result", {"answer": "Synthetic answer", "citations": [], "warnings": []}
                ),
            ),
        )
        a, b = await context.new_page(), await context.new_page()
        for page in (a, b):
            page.on("pageerror", lambda e: errors.append(str(e)))
        await asyncio.gather(*(page.goto(BASE + "/workspace/chats/new") for page in (a, b)))

        async def send(page, text):
            await page.get_by_role("checkbox", name="Fixture v1").check()
            await page.get_by_role("textbox", name="Message", exact=True).fill(text)
            await page.get_by_role("button", name="Send", exact=True).click()
            await expect(page.get_by_text("Synthetic answer", exact=True)).to_be_visible()

        await asyncio.gather(send(a, "Tab A fixture"), send(b, "Tab B fixture"))
        for page in (a, b):
            await page.wait_for_function(
                "Object.keys(localStorage).filter(k => k.startsWith('document-lab.chat.v2.')).length === 2"
            )
            await page.reload()
            await expect(page.get_by_role("textbox", name="Message", exact=True)).to_be_visible()
        await a.evaluate(
            "localStorage.setItem('document-lab.threads', '{}'); localStorage.setItem('document-lab.settings', 'null')"
        )
        await a.reload()
        await expect(a.get_by_role("textbox", name="Message", exact=True)).to_be_visible()
        assert (
            await a.evaluate(
                "Object.keys(localStorage).filter(k => k.startsWith('document-lab.chat.v2.')).length"
            )
            == 2
        )
        assert not errors, errors
        await browser.close()
        print(
            "PASS: concurrent two-tab chats survive reload; malformed cache preserves usable workspace and valid chats"
        )


if __name__ == "__main__":
    asyncio.run(main())
