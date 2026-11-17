"""Browser checks for the React UI. Run with uv run --with playwright python -m scripts.check_web_frontend."""

import json
from pathlib import Path

from playwright.sync_api import sync_playwright

from scripts.browser import BASE, SavedChats, launch_options


def main():
    checks = []
    Path(".local").mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_options(), args=["--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.route(
            "**/api/rag/documents",
            lambda route: route.fulfill(
                json=[
                    {
                        "id": "11111111-1111-4111-8111-111111111111",
                        "title": "Test manual",
                        "edition": "v1",
                    }
                ]
            ),
        )
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_selector(".galaxy-container canvas")
        page.wait_for_timeout(1000)
        assert page.locator("canvas").count() >= 2
        checks.append("WebGL hero and masked canvas mount")
        page.screenshot(path=".local/web-landing-desktop.png")
        # Demo questions follow web/src/content/landing-demo.ts (scripted Ask demo runs).
        panel = page.locator("#examples")
        panel.get_by_role("button", name="Connect two ideas").click()
        panel.get_by_text("Why do my Pods disappear when a node fails?").wait_for()
        panel.get_by_role("button", name="Pause demo", exact=True).click()
        panel.get_by_role("button", name="Play demo", exact=True).wait_for()
        page.wait_for_timeout(400)
        page.screenshot(path=".local/web-examples-desktop.png")
        checks.append("Interactive demo questions, question and pause")
        page.goto(BASE + "/workspace/chats/new", wait_until="networkidle")
        page.locator("input[type=checkbox]").first.wait_for()
        assert page.get_by_role("button", name="Send", exact=True).is_disabled()
        page.locator("input[type=checkbox]").first.check()
        checks.append("Mocked document list; sending requires selection")
        with page.expect_file_chooser():
            page.get_by_role("button", name="Upload document", exact=True).click()
        checks.append("Native file chooser")
        requests = []
        saved_chats = SavedChats()  # Chats live on the server: the fake saves them too.
        saved_chats.install(page)

        def query(route):
            body = route.request.post_data_json
            requests.append(body)
            chat_id = body.get("thread_id") or body["new_thread_id"]
            data = "event: session\ndata: " + json.dumps({"thread_id": chat_id}) + "\n\n"
            data += 'event: progress\ndata: {"step":"retrieve"}\n\n'
            result = {
                "answer": "**Blue labels** are required. [1]\n\n- Include title\n- Include edition",
                "citations": [
                    {
                        "citation": 1,
                        "document_id": "doc",
                        "document_title": "Test manual",
                        "edition": "v1",
                        "kind": "section",
                        "number": "1",
                        "page": 3,
                    }
                ],
            }
            data += "event: result\ndata: " + json.dumps(result) + "\n\n"
            saved_chats.record(chat_id, body["user_query"], result["answer"], result["citations"])
            route.fulfill(content_type="text/event-stream", body=data)

        page.route("**/api/rag/query", query)
        page.get_by_role("textbox", name="Message", exact=True).fill("What color?")
        page.get_by_role("button", name="Send", exact=True).click()
        page.get_by_text("Blue labels", exact=True).wait_for()
        assert (
            page.locator('[data-streamdown="strong"]').filter(has_text="Blue labels").count() == 1
        )
        page.get_by_text("[1] Test manual · Page 3", exact=True).click()
        checks.append("SSE progress, Markdown answer, expandable citations")
        page.get_by_role("textbox", name="Message", exact=True).fill("What else?")
        page.get_by_role("button", name="Send", exact=True).click()
        page.wait_for_function("document.querySelectorAll('[data-streamdown=strong]').length >= 2")
        # The browser chose the new chat's id; the follow-up continues that chat.
        assert requests[0]["thread_id"] is None and requests[0]["new_thread_id"]
        assert requests[1]["thread_id"] == requests[0]["new_thread_id"]
        assert "messages" not in requests[1]
        checks.append("Follow-up continues the browser-chosen chat id with a bounded request")
        page.reload(wait_until="networkidle")
        page.get_by_text("Blue labels", exact=True).first.wait_for()
        checks.append("Recent conversation, sources and citations reload from the server")
        page.get_by_role("button", name="Settings and more").click()
        page.get_by_role("menuitem", name="Dark", exact=True).click()
        assert "dark" in page.locator("html").get_attribute("class")
        page.screenshot(path=".local/web-chat-dark.png")
        checks.append("Theme switching")
        for width in [390, 768, 1440]:
            page.set_viewport_size({"width": width, "height": 900})
            page.goto(BASE, wait_until="networkidle")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
            page.goto(BASE + "/workspace/chats/new", wait_until="networkidle")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
            if width == 390:
                page.get_by_role("button", name="Toggle Sidebar").click()
                page.get_by_role("button", name="Upload document", exact=True).wait_for()
                page.keyboard.press("Escape")
                page.screenshot(path=".local/web-chat-mobile.png")
        checks.append("390/768/1440 layouts and accessible mobile sidebar")
        reduced = browser.new_page(reduced_motion="reduce", viewport={"width": 1200, "height": 900})
        reduced.goto(BASE, wait_until="networkidle")
        reduced.locator("#examples").scroll_into_view_if_needed()
        # Reduced motion shows the first demo run's finished answer (landing-demo.ts).
        reduced.locator("#examples").get_by_text("A Pod is the unit Kubernetes schedules", exact=False).wait_for()
        assert reduced.locator(".galaxy-container canvas").count() == 0
        checks.append("Reduced motion removes WebGL and leaves example answers readable")
        assert not errors, errors
        checks.append("No browser runtime errors")
        browser.close()
    Path(".local/web-checks.json").write_text(json.dumps(checks, indent=2))
    for check in checks:
        print("PASS:", check)


if __name__ == "__main__":
    main()
