"""Headless Chrome web-research contracts with mocked APIs; no provider usage."""

import json
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from scripts.browser import BASE, launch

URL = "https://example.org/web-source-sentinel"


def frame(event, data):
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def main():
    checks, requests, errors = [], [], []
    Path(".local").mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page(viewport={"width": 1280, "height": 960})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route("**/api/rag/health", lambda r: r.fulfill(json={"web_available": True}))
        page.route(
            "**/api/rag/documents",
            lambda r: r.fulfill(
                json=[
                    {
                        "id": "11111111-1111-4111-8111-111111111111",
                        "title": "Document fixture",
                        "edition": "v1",
                    }
                ]
            ),
        )
        document = {
            "citation": 1,
            "source_type": "document",
            "document_id": "11111111-1111-4111-8111-111111111111",
            "document_title": "Document fixture",
            "edition": "v1",
            "number": "1",
            "kind": "section",
            "page": 1,
        }
        web = {
            "citation": 2,
            "source_type": "web",
            "url": URL,
            "title": "Public fixture",
            "retrieved_at": "2026-11-04",
            "published_date": "2026-10-01",
        }
        def query(route):
            body = route.request.post_data_json
            requests.append(body)
            is_web = len(requests) == 1
            result = {
                "answer": "## From your documents\n\nDocument finding [1].\n\n## From the web\n\nExternal live finding [2]."
                if is_web
                else "Document-only follow-up [1].",
                "citations": [document, web] if is_web else [document],
                "warnings": ["Web evidence partial for wq1."] if is_web else [],
            }
            route.fulfill(
                content_type="text/event-stream",
                body=frame("session", {"thread_id": "22222222-2222-4222-8222-222222222222"})
                + frame("progress", {"step": "web" if is_web else "answer", "status": "completed"})
                + frame("token", {"delta": "Provisional draft"})
                + frame("result", result),
            )

        page.route("**/api/rag/query", query)
        page.goto(BASE + "/workspace/chats/new", wait_until="networkidle")
        page.get_by_role("checkbox", name="Document fixture v1").check()
        expect(page.get_by_role("checkbox", name="Search web for this message")).to_have_count(0)
        page.get_by_role("textbox", name="Message", exact=True).fill(
            "Compare with my selected documents"
        )
        page.get_by_role("button", name="Send", exact=True).click()
        expect(page.get_by_role("heading", name="From your documents", exact=True)).to_be_visible()
        expect(page.get_by_role("heading", name="From the web", exact=True)).to_be_visible()
        checks.append("Document and web answers render as separate sections")
        expect(page.get_by_role("link", name="Public fixture · example.org")).to_have_attribute(
            "href", URL
        )
        expect(page.get_by_text("Published: 2026-10-01", exact=True)).to_be_visible()
        page.get_by_text("[1] Document fixture · Page 1", exact=True).click()
        checks.append("Web link/date and document citation metadata remain distinct")
        expect(page.get_by_text("Web evidence partial for wq1.", exact=True)).to_be_visible()
        expect(page.get_by_text("Provisional draft", exact=True)).to_have_count(0)
        assert "web_queries" not in requests[0]
        assert "web_requested" not in requests[0]
        assert "messages" not in requests[0]
        checks.append(
            "Automatic fallback displays without client controls; final text replaces draft"
        )
        page.wait_for_function(
            "Object.keys(localStorage).filter(k => k.startsWith('document-lab.chat.v2.')).some(k => localStorage.getItem(k)?.includes('External live finding'))"
        )
        saved = page.evaluate(
            "JSON.stringify(Object.keys(localStorage).filter(k => k.startsWith('document-lab.chat.v2.')).map(k => localStorage.getItem(k)))"
        )
        assert URL in saved and "External live finding" in saved
        checks.append("Browser persistence keeps the web answer and its source link")
        page.get_by_role("textbox", name="Message", exact=True).fill("Document-only follow-up")
        page.get_by_role("button", name="Send", exact=True).click()
        expect(page.get_by_text("Document-only follow-up [1].", exact=True)).to_be_visible()
        assert not requests[1].get("web_requested")
        checks.append("Document-sufficient follow-up displays without web content")
        page.reload(wait_until="networkidle")
        # The web section, its finding and its source link survive a reload.
        expect(page.get_by_role("heading", name="From the web", exact=True)).to_be_visible()
        expect(page.get_by_text("External live finding [2].", exact=True)).to_be_visible()
        expect(page.get_by_role("link", name="Public fixture · example.org")).to_have_attribute("href", URL)
        expect(page.get_by_text("Published: 2026-10-01", exact=True)).to_be_visible()
        expect(page.get_by_text(re.compile("not retained"))).to_have_count(0)
        checks.append("Restored conversation shows the web answer and its source link")
        page.set_viewport_size({"width": 390, "height": 900})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        checks.append("Mixed response fits mobile viewport")
        assert not errors, errors
        checks.append("No browser runtime errors")
        page.screenshot(path=".local/web-research.png", full_page=True)
        browser.close()
    Path(".local/web-research-results.json").write_text(json.dumps(checks, indent=2))
    for check in checks:
        print("PASS:", check)


if __name__ == "__main__":
    main()
