"""Deletion UI regressions in isolated browser storage with mocked provider APIs."""


from playwright.sync_api import expect, sync_playwright

BASE = "http://127.0.0.1:3001"
DOC = "11111111-1111-4111-8111-111111111111"
CHAT = "22222222-2222-4222-8222-222222222222"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        )
        context = browser.new_context()
        errors, deleted = [], []
        docs = [{"id": DOC, "title": "Disposable handbook", "edition": "test"}]
        failures = [True]
        context.route("**/api/rag/health", lambda r: r.fulfill(json={"web_available": False}))
        context.route("**/api/rag/documents", lambda r: r.fulfill(json=docs))
        context.route("**/api/rag/deletions", lambda r: r.fulfill(json=deleted))

        def remove_doc(route):
            assert route.request.method == "DELETE"
            docs.clear()
            if not deleted:
                deleted.append({"kind": "document", "id": DOC, "pending": True})
                route.fulfill(status=202, json={"status": "cleanup_pending"})
            else:
                deleted[0]["pending"] = False
                route.fulfill(json={"status": "deleted"})

        def remove_chat(route):
            assert route.request.method == "DELETE"
            if failures.pop() if failures else False:
                route.fulfill(status=503, json={"detail": "Temporary failure. Retry."})
            else:
                deleted.append({"kind": "conversation", "id": CHAT, "pending": False})
                route.fulfill(json={"status": "deleted"})

        context.route("**/api/rag/documents/" + DOC, remove_doc)
        context.route("**/api/rag/conversations/" + CHAT, remove_chat)
        thread = {
            "id": "fixture",
            "title": "Disposable chat",
            "updatedAt": 1,
            "serverThreadId": CHAT,
            "documentIds": [DOC],
            "todos": [],
            "messages": [
                {
                    "id": "a",
                    "role": "assistant",
                    "text": "Saved document finding [1].",
                    "reasoning": "",
                    "steps": [],
                    "status": "complete",
                    "citations": [
                        {
                            "citation": 1,
                            "source_type": "document",
                            "document_id": DOC,
                            "document_title": "Disposable handbook",
                            "edition": "test",
                            "number": "1",
                            "kind": "section",
                        }
                    ],
                }
            ],
        }
        a, b = context.new_page(), context.new_page()
        for page in (a, b):
            page.on("pageerror", lambda e: errors.append(str(e)))
        a.goto(BASE + "/workspace/chats/new")
        a.evaluate(
            '(t)=>localStorage.setItem("document-lab.chat.v2.fixture",JSON.stringify({thread:t}))',
            thread,
        )
        for page in (a, b):
            page.goto(BASE + "/workspace/chats/fixture", wait_until="networkidle")
        a.get_by_role("button", name="Delete Disposable handbook", exact=True).click()
        a.get_by_role("button", name="Cancel", exact=True).click()
        assert docs
        a.get_by_role("button", name="Delete Disposable handbook", exact=True).click()
        a.get_by_role("button", name="Delete", exact=True).click()
        expect(a.get_by_text("Source removed; external cleanup pending.")).to_be_visible()
        expect(a.get_by_text("Source unavailable (deleted)", exact=False)).to_be_visible()
        expect(a.get_by_role("textbox", name="Message", exact=True)).to_be_disabled()
        expect(a.get_by_text("Saved document finding [1].", exact=True)).to_be_visible()
        a.get_by_role("button", name="Delete pending source cleanup", exact=True).click()
        a.get_by_role("button", name="Delete", exact=True).click()
        expect(a.get_by_text("Source removed; external cleanup pending.")).to_have_count(0)
        a.get_by_role("button", name="Delete Disposable chat", exact=True).click()
        a.get_by_role("button", name="Delete", exact=True).click()
        expect(a.get_by_role("alert")).to_contain_text("Temporary failure")
        a.get_by_role("button", name="Retry deletion", exact=True).click()
        expect(a).to_have_url(BASE + "/workspace/chats/new")
        expect(b).to_have_url(BASE + "/workspace/chats/new")
        # Restore a stale payload without its local marker: server reconciliation removes it.
        a.evaluate(
            '(t)=>{localStorage.removeItem("document-lab.deleted-chat.v2.fixture");localStorage.setItem("document-lab.chat.v2.fixture",JSON.stringify({thread:t}));}',
            thread,
        )
        a.reload(wait_until="networkidle")
        expect(a.get_by_role("button", name="Delete Disposable chat", exact=True)).to_have_count(0)
        a.set_viewport_size({"width": 390, "height": 844})
        assert a.evaluate("document.documentElement.scrollWidth <= innerWidth")
        draft = {**thread, "id": "mobile-draft", "title": "Mobile draft"}
        draft.pop("serverThreadId")
        a.evaluate('(t)=>localStorage.setItem("document-lab.chat.v2.mobile-draft",JSON.stringify({thread:t}))', draft)
        a.goto(BASE + '/workspace/chats', wait_until='networkidle')
        trigger = a.get_by_role('button', name='Delete Mobile draft', exact=True)
        trigger.click()
        a.keyboard.press('Escape')
        expect(trigger).to_be_focused()
        trigger.press('Enter')
        a.get_by_role('button', name='Delete', exact=True).click()
        expect(trigger).to_have_count(0)
        a.reload(wait_until='networkidle')
        expect(a.get_by_role('button', name='Delete Mobile draft', exact=True)).to_have_count(0)
        assert not errors, errors
        browser.close()
        print(
            "PASS: cancel, document cleanup pending/retry, preserved history, unavailable citations, blocked follow-up, chat error/retry, active redirect, cross-tab and stale-cache deletion, mobile width"
        )


if __name__ == "__main__":
    main()
