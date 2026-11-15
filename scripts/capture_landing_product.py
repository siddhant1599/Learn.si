"""Capture the real UI with fictional fixtures only; no provider or database calls.

Run against the production frontend:
uv run --with playwright python -m scripts.capture_landing_product
"""
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from scripts.check_web_master import BASE, CHROME, COURSE, DOC, LESSONS, FixtureBackend, run

OUTPUT = Path(__file__).resolve().parents[1] / "web/public/images"


def capture():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
        context.add_init_script("localStorage.setItem('theme', 'dark')")
        page = context.new_page()
        backend = FixtureBackend()
        page.route("**/api/rag/**", backend.handle)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        run(page, backend, errors)
        page.goto(f"{BASE}/workspace/courses/{COURSE}/lessons/{LESSONS[0][0]}")
        expect(page.get_by_role("heading", level=2, name="Explanation")).to_be_visible()
        expect(page.get_by_label("Ask the tutor")).to_be_visible()
        page.evaluate("document.fonts.ready")
        page.screenshot(path=str(OUTPUT / "product-master.png"))
        context.close()

        # A fresh context prevents Master fixture IDs/cache from leaking into Ask.
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
        context.add_init_script("localStorage.setItem('theme', 'dark')")
        page = context.new_page()

        def ask(route):
            path = route.request.url.split('/api/rag/')[-1]
            if path == 'documents':
                route.fulfill(json=[{"id": DOC, "title": "Archive Handbook", "edition": "Example"}])
            elif path == 'health':
                route.fulfill(json={"status": "ok", "web_available": False})
            elif path == 'query':
                result = {"answer": "## From your document\n\nEach archive label includes a **department code, sequence number, retention category and date range**. Put the code first so shelves can be sorted consistently. [1]\n\nFor example, a label for the HR department can use the code HR-007. Check the retention category before filing the record.", "citations": [{"citation": 1, "document_id": DOC, "document_title": "Archive Handbook", "edition": "Example", "kind": "section", "number": "1.1", "title": "Labels", "page": 1}]}
                body = 'event: session\ndata: {"thread_id":"11111111-1111-4111-8111-111111111111"}\n\n'
                body += 'event: result\ndata: ' + json.dumps(result) + '\n\n'
                route.fulfill(content_type='text/event-stream', body=body)
            else:
                route.fulfill(json=[])

        page.route('**/api/rag/**', ask)
        page.goto(BASE + '/workspace/chats/new')
        page.locator('input[type=checkbox]').first.check()
        page.get_by_role('textbox', name='Message', exact=True).fill('What should I include on an archive label?')
        page.get_by_role('button', name='Send', exact=True).click()
        expect(page.get_by_text('From your document', exact=True)).to_be_visible()
        expect(page.get_by_text('[1] Archive Handbook · Page 1', exact=True)).to_be_visible()
        page.evaluate('document.fonts.ready')
        page.screenshot(path=str(OUTPUT / 'product-ask.png'))
        browser.close()
    print('Saved real Ask/Master UI captures using fictional fixtures only.')


if __name__ == '__main__':
    capture()
